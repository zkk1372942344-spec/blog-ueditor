/**
 * blog-ueditor 主应用组件
 *
 * 富文本清洗与离线导出工具的主界面组件。
 * 提供编辑、预览、清洗和导出功能。
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import UEditorWidget, { type UEditorRef } from './components/UEditorWidget';
import { cleanHtml, type CleanResult, type CleanOptions } from './utils/htmlCleaner';
import {
  createExport,
  pollExportStatus,
  downloadArchive,
  triggerDownload,
  getManifest,
  retryFailedImage,
  ApiError,
} from './services/api';
import type {
  CleanMode,
  ExportStatusResponse,
  FailedImageStrategy,
  ImageInfo,
} from './types/api';
import './App.css';

/** 应用状态 */
interface AppState {
  /** 当前清洗模式 */
  mode: CleanMode;
  /** 原始 HTML 内容 */
  rawHtml: string;
  /** 清洗后的 HTML 内容 */
  cleanedHtml: string;
  /** 清洗结果统计 */
  cleanResult: CleanResult | null;
  /** 清洗配置 */
  cleanOptions: CleanOptions;
  /** 清洗预设 */
  cleanPreset: CleanPreset;
  /** 用户默认清洗配置 */
  userDefaultCleanOptions: CleanOptions;
  /** 导出配置 */
  exportOptions: ExportOptionsState;
  /** 是否正在导出 */
  isExporting: boolean;
  /** 导出进度文本 */
  exportProgress: string;
  /** 导出失败的图片列表 */
  exportFailedImages: ImageInfo[];
  /** 最近一次导出任务 ID */
  lastExportId: string;
  /** 重试进度 */
  retryProgress: {
    done: number;
    total: number;
  } | null;
  /** 错误信息 */
  error: string;
  /** 成功信息 */
  success: string;
}

/** 导出配置 */
interface ExportOptionsState {
  /** 是否下载图片 */
  downloadImages: boolean;
  /** 下载失败图片处理策略 */
  failedImageStrategy: FailedImageStrategy;
}

/** 清洗预设 */
type CleanPreset = 'default' | 'layout' | 'clean' | 'custom';

const CLEAN_PRESETS: Record<Exclude<CleanPreset, 'custom'>, CleanOptions> = {
  default: {
    keepClasses: true,
    keepIds: true,
    keepInlineStyles: true,
  },
  layout: {
    keepClasses: false,
    keepIds: false,
    keepInlineStyles: true,
  },
  clean: {
    keepClasses: false,
    keepIds: false,
    keepInlineStyles: false,
  },
};

const SETTINGS_STORAGE_KEY = 'blog-ueditor-settings';

const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  keepClasses: true,
  keepIds: true,
  keepInlineStyles: true,
  allowedTags: [],
  allowedAttributes: [],
};

const DEFAULT_EXPORT_OPTIONS: ExportOptionsState = {
  downloadImages: true,
  failedImageStrategy: 'keep_remote',
};

function App() {
  // 编辑器引用
  const editorRef = useRef<UEditorRef>(null);

  // 应用状态
  const [state, setState] = useState<AppState>({
    mode: 'safe',
    rawHtml: '',
    cleanedHtml: '',
    cleanResult: null,
    cleanOptions: DEFAULT_CLEAN_OPTIONS,
    cleanPreset: 'default',
    userDefaultCleanOptions: DEFAULT_CLEAN_OPTIONS,
    exportOptions: DEFAULT_EXPORT_OPTIONS,
    isExporting: false,
    exportProgress: '',
    exportFailedImages: [],
    lastExportId: '',
    retryProgress: null,
    error: '',
    success: '',
  });

  /**
   * 更新状态的辅助函数
   */
  const updateState = useCallback((updates: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * 初始化设置（本地存储）
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored) as {
        cleanOptions?: CleanOptions;
        cleanPreset?: CleanPreset;
        exportOptions?: ExportOptionsState;
        userDefaultCleanOptions?: CleanOptions;
      };

      const resolvedDefaultCleanOptions = parsed.userDefaultCleanOptions ?? DEFAULT_CLEAN_OPTIONS;

      updateState({
        cleanOptions: parsed.cleanOptions ?? resolvedDefaultCleanOptions,
        cleanPreset: parsed.cleanPreset ?? 'default',
        exportOptions: parsed.exportOptions ?? DEFAULT_EXPORT_OPTIONS,
        userDefaultCleanOptions: resolvedDefaultCleanOptions,
      });
    } catch (error) {
      console.warn('读取本地设置失败:', error);
    }
  }, [updateState]);

  /**
   * 持久化设置（本地存储）
   */
  useEffect(() => {
    try {
      const payload = {
        cleanOptions: state.cleanOptions,
        cleanPreset: state.cleanPreset,
        exportOptions: state.exportOptions,
        userDefaultCleanOptions: state.userDefaultCleanOptions,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('保存本地设置失败:', error);
    }
  }, [state.cleanOptions, state.cleanPreset, state.exportOptions]);

  /**
   * 清除消息
   */
  const clearMessages = useCallback(() => {
    updateState({ error: '', success: '' });
  }, [updateState]);

  /**
   * 生成导出任务的幂等键
   * @param html - 导出 HTML 内容
   * @param mode - 清洗模式
   * @returns 幂等键字符串
   */
  const createIdempotencyKey = useCallback((
    html: string,
    mode: CleanMode,
    exportOptions: ExportOptionsState
  ): string => {
    // 使用稳定哈希生成幂等键，确保同一内容与导出选项重复点击不会创建多任务
    const payload = JSON.stringify({
      mode,
      html,
      exportOptions,
    });
    let hash = 5381;

    for (let i = 0; i < payload.length; i += 1) {
      hash = (hash << 5) + hash + payload.charCodeAt(i);
      hash &= 0xffffffff;
    }

    return `export-${Math.abs(hash)}`;
  }, []);

  /**
   * 处理编辑器内容变化
   */
  const handleContentChange = useCallback(
    (html: string) => {
      updateState({
        rawHtml: html,
        cleanResult: null,
        cleanedHtml: '',
        exportFailedImages: [],
      });
      clearMessages();
    },
    [updateState, clearMessages]
  );

  /**
   * 处理模式切换
   */
  const handleModeChange = useCallback(
    (mode: CleanMode) => {
      updateState({
        mode,
        cleanResult: null,
        cleanedHtml: '',
        exportFailedImages: [],
      });
      clearMessages();
    },
    [updateState, clearMessages]
  );

  /**
   * 更新清洗配置
   * @param option - 清洗配置项
   * @param value - 配置值
   */
  const handleCleanOptionChange = useCallback(
    (option: keyof CleanOptions, value: boolean | string[]) => {
      updateState({
        cleanOptions: {
          ...state.cleanOptions,
          [option]: value,
        },
        cleanPreset: 'custom',
        cleanResult: null,
        cleanedHtml: '',
      });
      clearMessages();
    },
    [state.cleanOptions, updateState, clearMessages]
  );

  /**
   * 处理文本输入的清洗配置
   * @param option - 清洗配置项
   * @param value - 原始输入值
   */
  const handleCleanTextOptionChange = useCallback(
    (option: 'allowedTags' | 'allowedAttributes', value: string) => {
      const items = value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      handleCleanOptionChange(option, items);
    },
    [handleCleanOptionChange]
  );

  /**
   * 应用清洗预设
   * @param preset - 预设名称
   */
  const handleCleanPresetChange = useCallback(
    (preset: CleanPreset) => {
      if (preset === 'custom') {
        return;
      }

      const nextOptions =
        preset === 'default'
          ? state.userDefaultCleanOptions
          : {
              ...DEFAULT_CLEAN_OPTIONS,
              ...CLEAN_PRESETS[preset],
            };

      updateState({
        cleanPreset: preset,
        cleanOptions: nextOptions,
        cleanResult: null,
        cleanedHtml: '',
      });
      clearMessages();
    },
    [state.userDefaultCleanOptions, updateState, clearMessages]
  );

  /**
   * 保存当前清洗配置为默认预设
   */
  const handleSaveDefaultCleanOptions = useCallback(() => {
    updateState({
      userDefaultCleanOptions: state.cleanOptions,
      cleanPreset: 'default',
    });
    clearMessages();
  }, [state.cleanOptions, updateState, clearMessages]);

  /**
   * 重置默认预设为内置配置
   */
  const handleResetDefaultCleanOptions = useCallback(() => {
    updateState({
      userDefaultCleanOptions: DEFAULT_CLEAN_OPTIONS,
      cleanPreset: 'default',
      cleanOptions: DEFAULT_CLEAN_OPTIONS,
      cleanResult: null,
      cleanedHtml: '',
    });
    clearMessages();
  }, [updateState, clearMessages]);

  /**
   * 更新导出配置
   * @param option - 导出配置项
   * @param value - 配置值
   */
  const handleExportOptionChange = useCallback(
    (option: keyof ExportOptionsState, value: boolean | FailedImageStrategy) => {
      updateState({
        exportOptions: {
          ...state.exportOptions,
          [option]: value,
        },
        exportFailedImages: [],
      });
      clearMessages();
    },
    [state.exportOptions, updateState, clearMessages]
  );

  /**
   * 执行 HTML 清洗
   */
  const handleClean = useCallback(() => {
    clearMessages();

    // 获取编辑器内容
    const html = editorRef.current?.getContent() || '';
    if (!html.trim()) {
      updateState({ error: '请先输入或粘贴内容' });
      return;
    }

    try {
      // 执行清洗
      const result = cleanHtml(html, state.mode, state.cleanOptions);
      updateState({
        cleanedHtml: result.html,
        cleanResult: result,
        success: `清洗完成：移除 ${result.stats.removedTags} 个标签，${result.stats.removedAttributes} 个属性，发现 ${result.stats.imagesFound} 张图片`,
      });
    } catch (err) {
      console.error('清洗失败:', err);
      updateState({ error: '清洗过程中发生错误' });
    }
  }, [state.mode, updateState, clearMessages]);

  /**
   * 执行导出
   */
  const handleExport = useCallback(async (overrideOptions: Partial<ExportOptionsState> = {}) => {
    clearMessages();

    // 确保有清洗后的内容
    let htmlToExport = state.cleanedHtml;
    if (!htmlToExport) {
      // 自动执行清洗
      const html = editorRef.current?.getContent() || '';
      if (!html.trim()) {
        updateState({ error: '请先输入或粘贴内容' });
        return;
      }
      const result = cleanHtml(html, state.mode, state.cleanOptions);
      htmlToExport = result.html;
      updateState({
        cleanedHtml: result.html,
        cleanResult: result,
      });
    }

    updateState({
      isExporting: true,
      exportProgress: '正在创建导出任务...',
      exportFailedImages: [],
    });

    try {
      // 使用覆盖配置生成本次导出选项
      const effectiveExportOptions: ExportOptionsState = {
        ...state.exportOptions,
        ...overrideOptions,
      };

      // 生成幂等键（相同内容与导出选项重复导出时复用任务）
      const idempotencyKey = createIdempotencyKey(
        htmlToExport,
        state.mode,
        effectiveExportOptions
      );

      // 创建导出任务
      const exportResponse = await createExport({
        html: htmlToExport,
        mode: state.mode,
        options: {
          download_images: effectiveExportOptions.downloadImages,
          rewrite_failed_images: effectiveExportOptions.failedImageStrategy,
        },
      }, { idempotencyKey });

      updateState({ exportProgress: '正在处理...' });

      // 轮询任务状态
      await pollExportStatus(
        exportResponse.id,
        (status: ExportStatusResponse) => {
          if (status.progress && status.stats) {
            const progress = `下载图片中: ${status.progress.done}/${status.progress.total}`;
            updateState({ exportProgress: progress });
          }
        },
        1000
      );

      updateState({ exportProgress: '正在下载文件...' });

      // 下载 ZIP 文件
      const blob = await downloadArchive(exportResponse.id);
      triggerDownload(blob, `blog-ueditor-${exportResponse.id}.zip`);

      // 获取 manifest，提取失败图片列表用于提示（失败时不中断导出流程）
      let failedImages: ImageInfo[] = [];
      try {
        const manifest = await getManifest(exportResponse.id);
        failedImages = manifest.images.filter((image) => image.status === 'failed');
      } catch (manifestError) {
        console.warn('获取 manifest 失败:', manifestError);
      }

      updateState({
        isExporting: false,
        exportProgress: '',
        exportFailedImages: failedImages,
        lastExportId: exportResponse.id,
        retryProgress: null,
        success: '导出成功！文件已开始下载，可解压后打开 index.html 浏览内容',
      });
    } catch (err) {
      console.error('导出失败:', err);
      const message = err instanceof ApiError ? err.message : '导出过程中发生错误';
      updateState({
        isExporting: false,
        exportProgress: '',
        error: message,
      });
    }
  }, [
    state.cleanedHtml,
    state.mode,
    state.cleanOptions,
    state.exportOptions,
    updateState,
    clearMessages,
    createIdempotencyKey,
  ]);


  /**
   * 清空编辑器
   */
  const handleClear = useCallback(() => {
    editorRef.current?.setContent('');
    updateState({
      rawHtml: '',
      cleanedHtml: '',
      cleanResult: null,
      exportFailedImages: [],
      lastExportId: '',
      retryProgress: null,
    });
    clearMessages();
  }, [updateState, clearMessages]);

  /**
   * 将 HTML 中的图片 URL 替换为本地文件名
   * @param html - 原始 HTML
   * @param imageUrls - 图片 URL 列表
   * @returns 替换后的 HTML
   */
  const replaceImageUrlsWithLocal = useCallback((html: string, imageUrls: string[]): string => {
    let result = html;
    const padWidth = Math.max(2, String(imageUrls.length).length);

    imageUrls.forEach((url, index) => {
      // 获取文件扩展名
      const urlPath = url.split('?')[0].split('#')[0];
      const lastPart = urlPath.split('/').pop() || '';
      let ext = '.jpg';
      if (lastPart.includes('.')) {
        const urlExt = '.' + lastPart.split('.').pop()?.toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(urlExt)) {
          ext = urlExt === '.jpeg' ? '.jpg' : urlExt;
        }
      }

      // 生成本地文件名：01.jpg, 02.png, ...
      const localFilename = `${String(index + 1).padStart(padWidth, '0')}${ext}`;

      // 替换 URL（处理各种引号情况）
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedUrl, 'g'), localFilename);
    });

    return result;
  }, []);

  /**
   * 复制清洗后的 HTML 到剪贴板（图片路径已替换为本地文件名）
   */
  const handleCopyHtml = useCallback(async () => {
    if (!state.cleanedHtml) {
      updateState({ error: '请先清洗内容' });
      return;
    }

    try {
      // 将图片 URL 替换为本地文件名
      const localizedHtml = state.cleanResult?.imageUrls.length
        ? replaceImageUrlsWithLocal(state.cleanedHtml, state.cleanResult.imageUrls)
        : state.cleanedHtml;

      await navigator.clipboard.writeText(localizedHtml);
      updateState({ success: 'HTML 代码已复制（图片路径已替换为本地文件名）' });
    } catch (err) {
      console.error('复制失败:', err);
      updateState({ error: '复制失败，请手动选择复制' });
    }
  }, [state.cleanedHtml, state.cleanResult, replaceImageUrlsWithLocal, updateState]);

  /**
   * 下载单张图片（通过后端代理）
   * @param url - 图片 URL
   * @param index - 图片索引
   */
  const handleDownloadImage = useCallback(async (url: string, index: number) => {
    try {
      updateState({ success: `正在下载图片 ${index + 1}...` });

      // 通过后端代理下载图片
      const proxyUrl = `/api/v1/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }

      // 获取文件扩展名
      const contentType = response.headers.get('Content-Type') || 'image/jpeg';
      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      };
      const ext = extMap[contentType] || '.jpg';

      // 使用简单的序号命名：01.jpg, 02.jpg, ...
      const paddedIndex = String(index + 1).padStart(2, '0');
      const filename = `${paddedIndex}${ext}`;

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      // 创建下载链接
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 释放 blob URL
      URL.revokeObjectURL(blobUrl);

      updateState({ success: `图片 ${filename} 下载成功` });
    } catch (err) {
      console.error('下载图片失败:', err);
      updateState({ error: `图片 ${index + 1} 下载失败，请尝试"打包下载全部"` });
    }
  }, [updateState]);

  /**
   * 下载全部图片（通过后端导出 ZIP）
   */
  const handleDownloadAllImages = useCallback(async () => {
    if (!state.cleanResult?.imageUrls.length) {
      updateState({ error: '没有找到图片' });
      return;
    }
    // 强制开启图片下载，确保打包后有 images/ 目录
    if (!state.exportOptions.downloadImages) {
      clearMessages();
      updateState({
        exportOptions: {
          ...state.exportOptions,
          downloadImages: true,
        },
      });
    }

    // 直接调用导出功能
    handleExport({ downloadImages: true });
  }, [
    state.cleanResult,
    state.exportOptions,
    handleExport,
    updateState,
    clearMessages,
  ]);

  /**
   * 重试下载失败的图片
   */
  const handleRetryFailedImages = useCallback(async () => {
    if (!state.lastExportId) {
      updateState({ error: '未找到可重试的导出任务' });
      return;
    }

    if (!state.exportFailedImages.length) {
      updateState({ error: '当前没有失败的图片需要重试' });
      return;
    }

    const failedImagesSnapshot = [...state.exportFailedImages];

    updateState({
      isExporting: true,
      exportProgress: '正在重试失败图片...',
      retryProgress: {
        done: 0,
        total: failedImagesSnapshot.length,
      },
    });
    clearMessages();

    try {
      let manifest = await retryFailedImage(state.lastExportId, failedImagesSnapshot[0].url);
      updateState({
        retryProgress: {
          done: 1,
          total: failedImagesSnapshot.length,
        },
      });

      for (let i = 1; i < failedImagesSnapshot.length; i += 1) {
        const image = failedImagesSnapshot[i];
        manifest = await retryFailedImage(state.lastExportId, image.url);
        updateState({
          retryProgress: {
            done: i + 1,
            total: failedImagesSnapshot.length,
          },
        });
      }

      const failedImages = manifest.images.filter((image) => image.status === 'failed');

      updateState({
        isExporting: false,
        exportProgress: '',
        exportFailedImages: failedImages,
        retryProgress: null,
        success: failedImages.length
          ? '失败图片已重试完成，仍有部分未成功，建议重新下载 ZIP 查看最新结果'
          : '失败图片已全部重试成功，建议重新下载 ZIP 获取完整离线包',
      });
    } catch (err) {
      console.error('重试失败图片失败:', err);
      const message = err instanceof ApiError ? err.message : '重试失败图片时发生错误';
      updateState({
        isExporting: false,
        exportProgress: '',
        retryProgress: null,
        error: message,
      });
    }
  }, [
    state.lastExportId,
    state.exportFailedImages,
    updateState,
    clearMessages,
    retryFailedImage,
  ]);

  /**
   * 重新下载最新的 ZIP 文件
   */
  const handleRedownloadArchive = useCallback(async () => {
    if (!state.lastExportId) {
      updateState({ error: '未找到可下载的导出任务' });
      return;
    }

    updateState({ isExporting: true, exportProgress: '正在下载最新 ZIP...' });
    clearMessages();

    try {
      const blob = await downloadArchive(state.lastExportId);
      triggerDownload(blob, `blog-ueditor-${state.lastExportId}.zip`);
      updateState({
        isExporting: false,
        exportProgress: '',
        success: 'ZIP 已重新下载，请解压查看最新内容',
      });
    } catch (err) {
      console.error('重新下载 ZIP 失败:', err);
      const message = err instanceof ApiError ? err.message : '重新下载 ZIP 失败';
      updateState({
        isExporting: false,
        exportProgress: '',
        error: message,
      });
    }
  }, [state.lastExportId, updateState, clearMessages, retryFailedImage]);

  /**
   * 重试单张失败图片
   * @param url - 图片 URL
   */
  const handleRetrySingleImage = useCallback(async (url: string) => {
    if (!state.lastExportId) {
      updateState({ error: '未找到可重试的导出任务' });
      return;
    }

    updateState({
      isExporting: true,
      exportProgress: '正在重试单张图片...',
      retryProgress: {
        done: 0,
        total: 1,
      },
    });
    clearMessages();

    try {
      const manifest = await retryFailedImage(state.lastExportId, url);
      const failedImages = manifest.images.filter((image) => image.status === 'failed');

      updateState({
        isExporting: false,
        exportProgress: '',
        exportFailedImages: failedImages,
        retryProgress: null,
        success: failedImages.length
          ? '单张图片重试完成，仍有失败图片可继续重试'
          : '单张图片重试成功，建议重新下载 ZIP 获取完整离线包',
      });
    } catch (err) {
      console.error('重试单张图片失败:', err);
      const message = err instanceof ApiError ? err.message : '重试单张图片时发生错误';
      updateState({
        isExporting: false,
        exportProgress: '',
        retryProgress: null,
        error: message,
      });
    }
  }, [state.lastExportId, updateState, clearMessages]);

  return (
    <div className="app">
      {/* 头部 */}
      <header className="app-header">
        <h1>blog-ueditor</h1>
        <p className="subtitle">富文本清洗与离线导出工具</p>
      </header>

      {/* 主内容区 */}
      <main className="app-main">
        {/* 工具栏 */}
        <div className="toolbar">
          {/* 模式选择 */}
          <div className="toolbar-group">
            <label className="toolbar-label">清洗模式：</label>
            <select
              value={state.mode}
              onChange={(e) => handleModeChange(e.target.value as CleanMode)}
              className="mode-select"
              disabled={state.isExporting}
            >
              <option value="safe">Safe（保留排版）</option>
              <option value="aggressive">Aggressive（精简样式）</option>
            </select>
          </div>

          {/* 清洗配置 */}
          <div className="toolbar-group toolbar-options">
            <span className="toolbar-label">清洗配置：</span>
            <label className="option-item">
              预设：
              <select
                value={state.cleanPreset}
                disabled={state.isExporting || state.mode === 'aggressive'}
                onChange={(e) => handleCleanPresetChange(e.target.value as CleanPreset)}
                className="option-select"
              >
                <option value="default">默认</option>
                <option value="layout">保留排版</option>
                <option value="clean">更干净</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={state.isExporting || state.mode === 'aggressive'}
              onClick={handleSaveDefaultCleanOptions}
            >
              保存为默认
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={state.isExporting || state.mode === 'aggressive'}
              onClick={handleResetDefaultCleanOptions}
            >
              重置默认
            </button>
            <label className="option-item">
              <input
                type="checkbox"
                checked={state.cleanOptions.keepInlineStyles ?? true}
                disabled={state.isExporting || state.mode === 'aggressive'}
                onChange={(e) => handleCleanOptionChange('keepInlineStyles', e.target.checked)}
              />
              保留样式
            </label>
            <label className="option-item">
              <input
                type="checkbox"
                checked={state.cleanOptions.keepClasses ?? true}
                disabled={state.isExporting || state.mode === 'aggressive'}
                onChange={(e) => handleCleanOptionChange('keepClasses', e.target.checked)}
              />
              保留 class
            </label>
            <label className="option-item">
              <input
                type="checkbox"
                checked={state.cleanOptions.keepIds ?? true}
                disabled={state.isExporting || state.mode === 'aggressive'}
                onChange={(e) => handleCleanOptionChange('keepIds', e.target.checked)}
              />
              保留 id
            </label>
            <span className="option-hint">（仅 Safe 生效）</span>
            <label className="option-item option-input">
              允许标签：
              <input
                type="text"
                className="option-text"
                placeholder="例如：section,figure"
                value={(state.cleanOptions.allowedTags || []).join(', ')}
                disabled={state.isExporting}
                onChange={(e) => handleCleanTextOptionChange('allowedTags', e.target.value)}
              />
            </label>
            <label className="option-item option-input">
              允许属性：
              <input
                type="text"
                className="option-text"
                placeholder="例如：data-id,aria-label"
                value={(state.cleanOptions.allowedAttributes || []).join(', ')}
                disabled={state.isExporting}
                onChange={(e) => handleCleanTextOptionChange('allowedAttributes', e.target.value)}
              />
            </label>
            <span className="option-hint">（逗号分隔，Safe/Aggressive 都生效）</span>
          </div>

          {/* 导出配置 */}
          <div className="toolbar-group toolbar-options">
            <span className="toolbar-label">导出配置：</span>
            <label className="option-item">
              <input
                type="checkbox"
                checked={state.exportOptions.downloadImages}
                disabled={state.isExporting}
                onChange={(e) => handleExportOptionChange('downloadImages', e.target.checked)}
              />
              下载图片
            </label>
            <label className="option-item">
              失败处理：
              <select
                value={state.exportOptions.failedImageStrategy}
                disabled={state.isExporting}
                onChange={(e) =>
                  handleExportOptionChange('failedImageStrategy', e.target.value as FailedImageStrategy)
                }
                className="option-select"
              >
                <option value="keep_remote">保留外链</option>
                <option value="remove">移除图片</option>
              </select>
            </label>
          </div>

          {/* 操作按钮 */}
          <div className="toolbar-group">
            <button onClick={handleClean} disabled={state.isExporting} className="btn btn-primary">
              清洗内容
            </button>
            <button onClick={() => handleExport()} disabled={state.isExporting} className="btn btn-success">
              {state.isExporting ? state.exportProgress : '导出 ZIP'}
            </button>
            <button onClick={handleCopyHtml} disabled={!state.cleanedHtml} className="btn btn-info">
              复制 HTML
            </button>
            <button onClick={handleClear} disabled={state.isExporting} className="btn btn-danger">
              清空
            </button>
          </div>
        </div>

        {/* 消息提示 */}
        {state.error && <div className="message message-error">{state.error}</div>}
        {state.success && <div className="message message-success">{state.success}</div>}
        {state.exportFailedImages.length > 0 && (
          <div className="message message-warning">
            <p className="failed-images-title">
              有 {state.exportFailedImages.length} 张图片下载失败，已保留外链：
            </p>
            <div className="failed-images-actions">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={state.isExporting}
                onClick={handleRetryFailedImages}
              >
                仅重试失败图片
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={state.isExporting || !state.lastExportId}
                onClick={handleRedownloadArchive}
              >
                重新下载 ZIP
              </button>
            </div>
            {state.retryProgress && (
              <div className="retry-progress">
                <div className="retry-progress-track">
                  <div
                    className="retry-progress-bar"
                    style={{
                      width: `${Math.round(
                        (state.retryProgress.done / state.retryProgress.total) * 100
                      )}%`,
                    }}
                  />
                </div>
                <span className="retry-progress-text">
                  重试进度：{state.retryProgress.done}/{state.retryProgress.total}
                </span>
              </div>
            )}
            <ul className="failed-images-list">
              {state.exportFailedImages.map((image, index) => (
                <li key={`${image.url}-${index}`}>
                  <div className="failed-image-row">
                    <span className="failed-image-url">{image.url}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-info"
                      disabled={state.isExporting}
                      onClick={() => handleRetrySingleImage(image.url)}
                    >
                      重试此图
                    </button>
                  </div>
                  <span className="failed-image-meta">
                    {image.error ? `错误：${image.error}` : '错误：未知'}
                    {typeof image.retry_count === 'number'
                      ? ` | 重试次数：${image.retry_count}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 编辑区域 */}
        <div className="editor-container">
          {/* 第一屏：编辑器 + 预览 */}
          <div className="first-screen">
            {/* 左侧：编辑器 */}
            <div className="editor-section">
              <h3>编辑器</h3>
              <p className="hint">粘贴或输入富文本内容（支持从秀米等编辑器复制）</p>
              <UEditorWidget
                ref={editorRef}
                id="main-editor"
                onChange={handleContentChange}
                options={{
                  initialFrameHeight: 400,
                }}
              />
            </div>

            {/* 右侧：预览 */}
            <div className="preview-section">
              <h3>
                清洗预览
                {state.cleanResult && (
                  <span className="preview-stats">
                    （{state.cleanResult.stats.imagesFound} 张图片）
                  </span>
                )}
              </h3>
              <div
                className="preview-content"
                dangerouslySetInnerHTML={{ __html: state.cleanedHtml || '<p style="color: #999; text-align: center; padding-top: 100px;">清洗后的内容将显示在这里</p>' }}
              />
            </div>
          </div>

          {/* 第二屏：源代码 + 图片预览 */}
          {state.cleanedHtml && (
            <div className="second-screen">
              {/* 左侧：HTML 源代码 */}
              <div className="source-section">
                <h3>
                  HTML 源代码
                  <button onClick={handleCopyHtml} className="btn btn-sm btn-info" style={{ marginLeft: '10px' }}>
                    复制
                  </button>
                </h3>
                <pre className="source-content">
                  <code>
                    {state.cleanResult?.imageUrls.length
                      ? replaceImageUrlsWithLocal(state.cleanedHtml, state.cleanResult.imageUrls)
                      : state.cleanedHtml}
                  </code>
                </pre>
              </div>

              {/* 右侧：图片预览 */}
              <div className="images-section">
                <h3>
                  图片预览 ({state.cleanResult?.imageUrls.length || 0})
                  {state.cleanResult?.imageUrls.length ? (
                    <button
                      onClick={handleDownloadAllImages}
                      className="btn btn-sm btn-success"
                      style={{ marginLeft: '10px' }}
                      disabled={state.isExporting}
                    >
                      {state.isExporting ? '下载中...' : '打包下载'}
                    </button>
                  ) : null}
                </h3>
                {state.cleanResult?.imageUrls.length ? (
                  <div className="images-grid">
                    {state.cleanResult.imageUrls.map((url, index) => (
                      <div key={index} className="image-card">
                        <div className="image-card-preview">
                          <img
                            src={`/api/v1/proxy-image?url=${encodeURIComponent(url)}`}
                            alt={`图片 ${index + 1}`}
                            loading="lazy"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (!target.dataset.fallback) {
                                target.dataset.fallback = 'true';
                                target.src = url;
                              }
                            }}
                          />
                        </div>
                        <div className="image-card-actions">
                          <span className="image-card-index">#{String(index + 1).padStart(2, '0')}</span>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleDownloadImage(url, index)}
                          >
                            下载
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="images-empty">暂无图片</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 统计信息 */}
        {state.cleanResult && (
          <div className="stats-bar">
            <span>移除标签: {state.cleanResult.stats.removedTags}</span>
            <span>移除属性: {state.cleanResult.stats.removedAttributes}</span>
            <span>发现图片: {state.cleanResult.stats.imagesFound}</span>
            <span>模式: {state.mode === 'safe' ? 'Safe' : 'Aggressive'}</span>
          </div>
        )}
      </main>

      {/* 页脚 */}
      <footer className="app-footer">
        <p>blog-ueditor - 基于 UEditor 的富文本清洗与离线导出工具</p>
        <p className="icp-info">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >
            浙ICP备2024121426号-2
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;

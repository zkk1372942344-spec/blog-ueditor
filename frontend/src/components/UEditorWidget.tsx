/**
 * UEditor React 组件封装
 *
 * 将 UEditor 编辑器封装为 React 组件，提供：
 * - 编辑器初始化和销毁管理
 * - 内容变化回调
 * - 粘贴事件处理
 * - 内容获取和设置方法
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { UEditorInstance, UEditorOptions } from '../types/ueditor.d';

/** 组件属性接口 */
interface UEditorProps {
  /** 编辑器容器 ID */
  id?: string;
  /** 编辑器配置选项 */
  options?: UEditorOptions;
  /** 初始内容 */
  initialContent?: string;
  /** 内容变化回调 */
  onChange?: (html: string) => void;
  /** 粘贴后回调 */
  onPaste?: (html: string) => void;
  /** 编辑器就绪回调 */
  onReady?: (editor: UEditorInstance) => void;
}

/** 暴露给父组件的方法接口 */
export interface UEditorRef {
  /** 获取编辑器 HTML 内容 */
  getContent: () => string;
  /** 获取纯文本内容 */
  getContentText: () => string;
  /** 设置编辑器内容 */
  setContent: (html: string, isAppend?: boolean) => void;
  /** 获取编辑器实例 */
  getEditor: () => UEditorInstance | null;
  /** 聚焦编辑器 */
  focus: () => void;
  /** 判断是否有内容 */
  hasContent: () => boolean;
}

/**
 * UEditor React 组件
 *
 * @example
 * ```tsx
 * const editorRef = useRef<UEditorRef>(null);
 *
 * <UEditorWidget
 *   ref={editorRef}
 *   onChange={(html) => console.log('内容变化:', html)}
 *   onPaste={(html) => console.log('粘贴内容:', html)}
 * />
 *
 * // 获取内容
 * const html = editorRef.current?.getContent();
 * ```
 */
const UEditorWidget = forwardRef<UEditorRef, UEditorProps>(
  ({ id = 'ueditor-container', options = {}, initialContent, onChange, onPaste, onReady }, ref) => {
    // 存储编辑器实例
    const editorRef = useRef<UEditorInstance | null>(null);
    // 标记是否已初始化
    const initializedRef = useRef(false);

    /**
     * 获取编辑器内容
     */
    const getContent = useCallback(() => {
      return editorRef.current?.getContent() || '';
    }, []);

    /**
     * 获取纯文本内容
     */
    const getContentText = useCallback(() => {
      return editorRef.current?.getContentTxt() || '';
    }, []);

    /**
     * 设置编辑器内容
     */
    const setContent = useCallback((html: string, isAppend = false) => {
      editorRef.current?.setContent(html, isAppend);
    }, []);

    /**
     * 获取编辑器实例
     */
    const getEditor = useCallback(() => {
      return editorRef.current;
    }, []);

    /**
     * 聚焦编辑器
     */
    const focus = useCallback(() => {
      editorRef.current?.focus();
    }, []);

    /**
     * 判断是否有内容
     */
    const hasContent = useCallback(() => {
      return editorRef.current?.hasContents() || false;
    }, []);

    // 暴露方法给父组件
    useImperativeHandle(
      ref,
      () => ({
        getContent,
        getContentText,
        setContent,
        getEditor,
        focus,
        hasContent,
      }),
      [getContent, getContentText, setContent, getEditor, focus, hasContent]
    );

    // 初始化编辑器
    useEffect(() => {
      // 防止重复初始化
      if (initializedRef.current) {
        return;
      }

      // 检查 UEditor 是否已加载
      if (typeof window.UE === 'undefined') {
        console.error('[UEditorWidget] UEditor 未加载，请检查脚本引入');
        return;
      }

      // 默认配置
      const defaultOptions: UEditorOptions = {
        initialFrameHeight: 400,
        initialFrameWidth: '100%',
        autoFloatEnabled: false,
        ...options,
      };

      // 创建编辑器实例
      const editor = window.UE.getEditor(id, defaultOptions);
      editorRef.current = editor;
      initializedRef.current = true;

      // 存储 resize 处理函数的引用，用于清理
      let resizeHandler: (() => void) | null = null;

      // 监听编辑器就绪事件
      editor.addListener('ready', () => {
        console.log('[UEditorWidget] 编辑器就绪');

        // 设置初始内容
        if (initialContent) {
          editor.setContent(initialContent);
        }

        /**
         * 动态调整编辑器高度以填满容器
         * 查找 .editor-section 容器并计算可用高度
         */
        const adjustHeight = () => {
          // 查找编辑器所在的 section 容器
          const editorSection = document.querySelector('.editor-section');
          if (!editorSection) {
            console.warn('[UEditorWidget] 未找到 .editor-section 容器');
            return;
          }

          // 获取容器总高度
          const sectionHeight = editorSection.clientHeight;

          // 获取标题和提示的高度
          const header = editorSection.querySelector('h3') as HTMLElement | null;
          const hint = editorSection.querySelector('.hint') as HTMLElement | null;
          const headerHeight = header?.offsetHeight || 0;
          const hintHeight = hint?.offsetHeight || 0;

          // 计算编辑器可用高度（减去标题、提示和一些边距）
          const availableHeight = sectionHeight - headerHeight - hintHeight - 20;

          if (availableHeight > 200) {
            editor.setHeight(availableHeight);
            console.log('[UEditorWidget] 设置编辑器高度:', availableHeight);
          }
        };

        // 初始调整（延迟以确保 DOM 完全渲染）
        setTimeout(adjustHeight, 200);
        // 再次调整以确保准确性
        setTimeout(adjustHeight, 500);

        // 创建 resize 处理函数
        resizeHandler = () => {
          // 使用防抖处理 resize 事件
          setTimeout(adjustHeight, 100);
        };

        // 监听窗口大小变化
        window.addEventListener('resize', resizeHandler);

        // 触发就绪回调
        if (onReady) {
          onReady(editor);
        }
      });

      // 监听内容变化事件
      editor.addListener('contentChange', () => {
        if (onChange) {
          const html = editor.getContent();
          onChange(html);
        }
      });

      // 监听粘贴事件
      editor.addListener('afterpaste', () => {
        if (onPaste) {
          const html = editor.getContent();
          onPaste(html);
        }
      });

      // 清理函数
      return () => {
        // 移除 resize 事件监听器
        if (resizeHandler) {
          window.removeEventListener('resize', resizeHandler);
        }

        if (editorRef.current) {
          try {
            window.UE.delEditor(id);
          } catch (e) {
            console.warn('[UEditorWidget] 销毁编辑器时出错:', e);
          }
          editorRef.current = null;
          initializedRef.current = false;
        }
      };
    }, [id]); // 只在 id 变化时重新初始化

    return (
      <div className="ueditor-widget">
        {/* UEditor 将在此容器中初始化 */}
        <script id={id} type="text/plain"></script>
      </div>
    );
  }
);

UEditorWidget.displayName = 'UEditorWidget';

export default UEditorWidget;

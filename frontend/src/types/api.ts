/**
 * API 接口类型定义
 *
 * 定义与后端 API 交互的数据结构
 */

/** 清洗模式 */
export type CleanMode = 'safe' | 'aggressive';

/** 失败图片处理策略 */
export type FailedImageStrategy = 'keep_remote' | 'remove';

/** 导出任务状态 */
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired';

/** 导出选项 */
export interface ExportOptions {
  /** 是否下载图片 */
  download_images?: boolean;
  /** 失败图片处理策略 */
  rewrite_failed_images?: FailedImageStrategy;
}

/** 创建导出任务请求 */
export interface CreateExportRequest {
  /** 清洗后的 HTML 内容 */
  html: string;
  /** 清洗模式 */
  mode?: CleanMode;
  /** 导出选项 */
  options?: ExportOptions;
}

/** 导出任务相关链接 */
export interface ExportLinks {
  /** 任务详情链接 */
  self: string;
  /** 下载链接 */
  archive: string;
  /** Manifest 链接 */
  manifest: string;
}

/** 导出进度 */
export interface ExportProgress {
  /** 已完成数量 */
  done: number;
  /** 总数量 */
  total: number;
}

/** 导出统计 */
export interface ExportStats {
  /** 发现的图片数量 */
  images_found: number;
  /** 成功下载的图片数量 */
  images_downloaded: number;
  /** 下载失败的图片数量 */
  images_failed: number;
  /** 总文件大小（字节） */
  total_size?: number;
}

/** 图片信息 */
export interface ImageInfo {
  /** 原始 URL */
  url: string;
  /** 本地文件名 */
  filename: string | null;
  /** 状态 */
  status: 'pending' | 'downloading' | 'downloaded' | 'failed';
  /** 文件大小（字节） */
  size?: number;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retry_count?: number;
}

/** 创建导出任务响应 */
export interface CreateExportResponse {
  /** 任务 ID */
  id: string;
  /** 任务状态 */
  status: ExportStatus;
  /** 创建时间 */
  created_at: string;
  /** 过期时间 */
  expires_at: string;
  /** 相关链接 */
  links: ExportLinks;
}

/** 导出任务状态响应 */
export interface ExportStatusResponse {
  /** 任务 ID */
  id: string;
  /** 任务状态 */
  status: ExportStatus;
  /** 进度信息 */
  progress?: ExportProgress;
  /** 统计信息 */
  stats?: ExportStats;
  /** 创建时间 */
  created_at: string;
  /** 过期时间 */
  expires_at: string;
  /** 相关链接 */
  links: ExportLinks;
  /** 错误信息（仅失败时） */
  error?: string;
}

/** Manifest 响应 */
export interface ManifestResponse {
  /** 导出 ID */
  export_id: string;
  /** 清洗模式 */
  mode: CleanMode;
  /** 创建时间 */
  created_at: string;
  /** 图片列表 */
  images: ImageInfo[];
  /** 统计信息 */
  stats: ExportStats;
}

/** 健康检查响应 */
export interface HealthResponse {
  /** 服务状态 */
  status: string;
  /** 版本号 */
  version: string;
  /** 运行时长（秒） */
  uptime: number;
}

/** RFC 7807 错误响应 */
export interface ProblemDetail {
  /** 错误类型 */
  type: string;
  /** 错误标题 */
  title: string;
  /** HTTP 状态码 */
  status: number;
  /** 详细描述 */
  detail: string;
  /** 请求实例 */
  instance: string;
}

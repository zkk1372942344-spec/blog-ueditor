/**
 * API 服务模块
 *
 * 封装与后端 API 的交互逻辑
 */

import type {
  CreateExportRequest,
  CreateExportResponse,
  ExportStatusResponse,
  ManifestResponse,
  HealthResponse,
  ProblemDetail,
} from '../types/api';

// API 基础地址（开发环境使用代理，生产环境使用相对路径）
const API_BASE_URL = '/api/v1';

/** API 错误类 */
export class ApiError extends Error {
  /** HTTP 状态码 */
  status: number;
  /** 错误详情 */
  detail: ProblemDetail | null;

  constructor(message: string, status: number, detail: ProblemDetail | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 发送 API 请求的通用函数
 *
 * @param endpoint - API 端点路径
 * @param options - fetch 选项
 * @returns 响应数据
 * @throws ApiError 当请求失败时
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  // 处理非 JSON 响应（如文件下载）
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/zip')) {
    if (!response.ok) {
      throw new ApiError('下载失败', response.status);
    }
    return response as unknown as T;
  }

  // 处理 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // 解析 JSON 响应
  let data: T | ProblemDetail;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('无法解析响应数据', response.status);
  }

  // 处理错误响应
  if (!response.ok) {
    const problemDetail = data as ProblemDetail;
    throw new ApiError(
      problemDetail.detail || problemDetail.title || '请求失败',
      response.status,
      problemDetail
    );
  }

  return data as T;
}

/**
 * 健康检查
 *
 * @returns 健康状态信息
 */
export async function checkHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health');
}

/**
 * 创建导出任务
 *
 * @param request - 导出请求参数
 * @returns 创建的任务信息
 */
export async function createExport(
  request: CreateExportRequest,
  options: { idempotencyKey?: string } = {}
): Promise<CreateExportResponse> {
  // 透传幂等键，避免重复创建导出任务
  const extraHeaders: HeadersInit = {};
  if (options.idempotencyKey) {
    extraHeaders['Idempotency-Key'] = options.idempotencyKey;
  }

  return apiRequest<CreateExportResponse>('/exports', {
    method: 'POST',
    body: JSON.stringify(request),
    headers: extraHeaders,
  });
}

/**
 * 查询导出任务状态
 *
 * @param exportId - 导出任务 ID
 * @returns 任务状态信息
 */
export async function getExportStatus(exportId: string): Promise<ExportStatusResponse> {
  return apiRequest<ExportStatusResponse>(`/exports/${exportId}`);
}

/**
 * 下载导出的 ZIP 文件
 *
 * @param exportId - 导出任务 ID
 * @returns Blob 对象
 */
export async function downloadArchive(exportId: string): Promise<Blob> {
  const url = `${API_BASE_URL}/exports/${exportId}/archive`;
  const response = await fetch(url);

  if (!response.ok) {
    // 尝试解析错误信息
    try {
      const error: ProblemDetail = await response.json();
      throw new ApiError(error.detail || error.title, response.status, error);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('下载失败', response.status);
    }
  }

  return response.blob();
}

/**
 * 获取 Manifest 信息
 *
 * @param exportId - 导出任务 ID
 * @returns Manifest 数据
 */
export async function getManifest(exportId: string): Promise<ManifestResponse> {
  return apiRequest<ManifestResponse>(`/exports/${exportId}/manifest`);
}

/**
 * 重试下载失败的图片
 *
 * @param exportId - 导出任务 ID
 * @returns 更新后的 Manifest 数据
 */
export async function retryFailedImages(exportId: string): Promise<ManifestResponse> {
  return apiRequest<ManifestResponse>(`/exports/${exportId}/retry-images`, {
    method: 'POST',
  });
}

/**
 * 重试单张失败图片
 *
 * @param exportId - 导出任务 ID
 * @param url - 失败图片 URL
 * @returns 更新后的 Manifest 数据
 */
export async function retryFailedImage(exportId: string, url: string): Promise<ManifestResponse> {
  return apiRequest<ManifestResponse>(`/exports/${exportId}/retry-image`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * 删除导出任务
 *
 * @param exportId - 导出任务 ID
 */
export async function deleteExport(exportId: string): Promise<void> {
  return apiRequest<void>(`/exports/${exportId}`, {
    method: 'DELETE',
  });
}

/**
 * 轮询任务状态直到完成
 *
 * @param exportId - 导出任务 ID
 * @param onProgress - 进度回调函数
 * @param interval - 轮询间隔（毫秒）
 * @param maxRetries - 最大重试次数
 * @returns 最终的任务状态
 */
export async function pollExportStatus(
  exportId: string,
  onProgress?: (status: ExportStatusResponse) => void,
  interval: number = 1000,
  maxRetries: number = 300
): Promise<ExportStatusResponse> {
  let retries = 0;

  while (retries < maxRetries) {
    const status = await getExportStatus(exportId);

    // 调用进度回调
    if (onProgress) {
      onProgress(status);
    }

    // 检查是否完成
    if (status.status === 'completed') {
      return status;
    }

    // 检查是否失败
    if (status.status === 'failed') {
      throw new ApiError(status.error || '导出失败', 500);
    }

    // 检查是否过期
    if (status.status === 'expired') {
      throw new ApiError('任务已过期', 410);
    }

    // 等待后重试
    await new Promise((resolve) => setTimeout(resolve, interval));
    retries++;
  }

  throw new ApiError('任务超时', 408);
}

/**
 * 触发文件下载
 *
 * @param blob - 文件 Blob
 * @param filename - 文件名
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

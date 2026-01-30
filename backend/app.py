"""
blog-ueditor 后端主应用

提供富文本清洗与离线导出功能的 FastAPI 后端服务。
支持异步图片下载、ZIP打包、manifest生成等功能。
"""

import asyncio
import base64
import hashlib
import re
import shutil
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ==================== 配置常量 ====================

# 临时文件存储目录
EXPORT_TEMP_DIR = Path("./export_temp")
EXPORT_TEMP_DIR.mkdir(exist_ok=True)

# 静态文件目录（前端构建产物）
STATIC_DIR = Path("./static")

# 导出任务过期时间（秒）
EXPORT_EXPIRY_SECONDS = 3600  # 1小时

# 图片下载超时时间（秒）
IMAGE_DOWNLOAD_TIMEOUT = 30

# 图片下载重试次数（不包含首次请求）
IMAGE_DOWNLOAD_RETRY_COUNT = 2

# 图片下载重试间隔（秒，基础值，按次数递增）
IMAGE_DOWNLOAD_RETRY_DELAY = 0.6

# HTML 内容最大大小（字节）
MAX_HTML_SIZE = 2 * 1024 * 1024  # 2MB

# 单次导出最大图片数量
MAX_IMAGES_COUNT = 200


# ==================== 数据模型 ====================

class CleanMode(str, Enum):
    """清洗模式枚举"""
    SAFE = "safe"
    AGGRESSIVE = "aggressive"


class FailedImageStrategy(str, Enum):
    """失败图片处理策略"""
    KEEP_REMOTE = "keep_remote"  # 保留原始外链
    REMOVE = "remove"  # 移除失败的图片引用


class ExportStatus(str, Enum):
    """导出任务状态"""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


class ExportOptions(BaseModel):
    """导出选项"""
    download_images: bool = Field(default=True, description="是否下载图片")
    rewrite_failed_images: FailedImageStrategy = Field(
        default=FailedImageStrategy.KEEP_REMOTE,
        description="失败图片处理策略"
    )


class CreateExportRequest(BaseModel):
    """创建导出任务请求"""
    html: str = Field(..., description="清洗后的 HTML 内容", min_length=1)
    mode: CleanMode = Field(default=CleanMode.SAFE, description="清洗模式")
    options: Optional[ExportOptions] = Field(default=None, description="导出选项")


class ImageInfo(BaseModel):
    """图片信息"""
    url: str
    filename: Optional[str] = None
    status: str = "pending"
    size: Optional[int] = None
    error: Optional[str] = None
    retry_count: int = 0


class ExportProgress(BaseModel):
    """导出进度"""
    done: int = 0
    total: int = 0


class ExportStats(BaseModel):
    """导出统计"""
    images_found: int = 0
    images_downloaded: int = 0
    images_failed: int = 0
    total_size: int = 0


class ExportLinks(BaseModel):
    """导出任务相关链接"""
    self_link: str = Field(..., alias="self")
    archive: str
    manifest: str

    class Config:
        populate_by_name = True


class ExportTask(BaseModel):
    """导出任务"""
    id: str
    status: ExportStatus = ExportStatus.QUEUED
    progress: ExportProgress = Field(default_factory=ExportProgress)
    stats: ExportStats = Field(default_factory=ExportStats)
    created_at: datetime
    expires_at: datetime
    links: ExportLinks
    mode: CleanMode = CleanMode.SAFE
    html: str = ""
    # 处理后的 HTML（用于导出 document 接口）
    processed_html: Optional[str] = None
    images: list[ImageInfo] = []
    options: ExportOptions = Field(default_factory=ExportOptions)
    error_message: Optional[str] = None


class ExportTaskResponse(BaseModel):
    """导出任务响应"""
    id: str
    status: ExportStatus
    progress: Optional[ExportProgress] = None
    stats: Optional[ExportStats] = None
    created_at: datetime
    expires_at: datetime
    links: ExportLinks


class ManifestResponse(BaseModel):
    """Manifest 响应"""
    export_id: str
    mode: CleanMode
    created_at: datetime
    images: list[ImageInfo]
    stats: ExportStats


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str
    uptime: int


class ProblemDetail(BaseModel):
    """RFC 7807 错误响应格式"""
    type: str
    title: str
    status: int
    detail: str
    instance: str


class RetryImageRequest(BaseModel):
    """重试单张图片请求"""
    url: str = Field(..., min_length=1, description="失败图片 URL")


# ==================== 内存存储（生产环境建议使用 Redis） ====================

# 导出任务缓存（key: task_id, value: ExportTask）
export_tasks: dict[str, ExportTask] = {}

# 幂等键缓存（key: idempotency_key, value: task_id）
idempotency_records: dict[str, str] = {}

# 应用启动时间（用于健康检查）
app_start_time = datetime.now(timezone.utc)


# ==================== FastAPI 应用初始化 ====================

app = FastAPI(
    title="blog-ueditor API",
    description="富文本清洗与离线导出工具后端服务",
    version="1.0.0"
)

# 配置 CORS（开发环境）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 工具函数 ====================

def generate_export_id() -> str:
    """生成唯一的导出任务 ID"""
    return f"exp_{uuid.uuid4().hex[:8]}"


def extract_image_urls(html: str) -> list[str]:
    """
    从 HTML 中提取所有图片 URL
    支持 img 标签 src、data-src、data-original 和 CSS background-image

    Args:
        html: HTML 字符串

    Returns:
        去重后的图片 URL 列表
    """
    urls = set()

    def add_url(url: str | None) -> None:
        """添加 URL 到集合（统一处理）"""
        if not url:
            return

        # 解码 HTML 实体
        decoded_url = (url
            .replace('&amp;', '&')
            .replace('&quot;', '"')
            .replace('&#39;', "'")
            .replace('&lt;', '<')
            .replace('&gt;', '>'))

        # 去除开头和结尾的引号（处理 url(&quot;...&quot;) 的情况）
        decoded_url = decoded_url.strip().strip('"\'')

        # 排除 data: 开头的 base64 图片（由单独逻辑处理）
        if decoded_url and not decoded_url.startswith('data:'):
            urls.add(decoded_url)

    # 提取 <img> 标签的 src 属性
    img_pattern = r'<img[^>]+src=["\']([^"\']+)["\']'
    for match in re.finditer(img_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 data-src 属性（懒加载图片）
    data_src_pattern = r'<img[^>]+data-src=["\']([^"\']+)["\']'
    for match in re.finditer(data_src_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 data-original 属性（另一种懒加载方式）
    data_original_pattern = r'<img[^>]+data-original=["\']([^"\']+)["\']'
    for match in re.finditer(data_original_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取任何标签上的 data-background-image 属性
    data_bg_pattern = r'data-background-image=["\']([^"\']+)["\']'
    for match in re.finditer(data_bg_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 background-image 中的 URL
    bg_pattern = r'background-image\s*:\s*url\(["\']?([^"\')\s]+)["\']?\)'
    for match in re.finditer(bg_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 background 中的 URL
    bg_short_pattern = r'background\s*:[^;]*url\(["\']?([^"\')\s]+)["\']?\)'
    for match in re.finditer(bg_short_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 list-style-image 中的 URL
    list_style_pattern = r'list-style-image\s*:\s*url\(["\']?([^"\')\s]+)["\']?\)'
    for match in re.finditer(list_style_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    # 提取 content: url(...) 中的 URL
    content_pattern = r'content\s*:\s*url\(["\']?([^"\')\s]+)["\']?\)'
    for match in re.finditer(content_pattern, html, re.IGNORECASE):
        add_url(match.group(1))

    return list(urls)


def extract_data_images(html: str) -> list[str]:
    """
    提取 HTML 中的 base64 data 图片 URL

    Args:
        html: HTML 字符串

    Returns:
        data:image/...;base64,... 列表
    """
    data_urls = []
    pattern = r'data:image/[^;]+;base64,[A-Za-z0-9+/=\\s]+'

    for match in re.finditer(pattern, html, re.IGNORECASE):
        data_url = match.group(0)
        if data_url:
            data_urls.append(data_url)

    return data_urls


def save_data_image(data_url: str, save_path: Path, index: int, total: int) -> ImageInfo:
    """
    保存 base64 data 图片为本地文件

    Args:
        data_url: data:image/...;base64,... 字符串
        save_path: 保存目录路径
        index: 图片序号（从1开始）
        total: 图片总数（用于计算序号位数）

    Returns:
        图片信息对象
    """
    image_info = ImageInfo(url=data_url, status="downloading")

    try:
        header, payload = data_url.split(',', 1)
        media_type = header.split(';')[0].replace('data:', '')
        ext = get_file_extension("", media_type)

        # 生成简单序号命名：01.jpg, 02.png, ...
        pad_width = len(str(total)) if total > 0 else 2
        pad_width = max(pad_width, 2)
        filename = f"{str(index).zfill(pad_width)}{ext}"
        file_path = save_path / filename

        # 清理可能的空白符后解码
        payload = re.sub(r'\s+', '', payload)
        file_bytes = b""
        try:
            file_bytes = base64.b64decode(payload, validate=True)
        except Exception:
            file_bytes = base64.b64decode(payload, validate=False)

        file_path.write_bytes(file_bytes)

        image_info.filename = f"images/{filename}"
        image_info.status = "downloaded"
        image_info.size = len(file_bytes)
        image_info.retry_count = 1
    except Exception as e:
        image_info.status = "failed"
        image_info.error = str(e)
        image_info.retry_count = 1

    return image_info


def get_file_extension(url: str, content_type: Optional[str] = None) -> str:
    """
    根据 URL 或 Content-Type 获取文件扩展名

    Args:
        url: 图片 URL
        content_type: HTTP Content-Type 头

    Returns:
        文件扩展名（包含点号）
    """
    # 从 URL 中提取扩展名
    url_path = url.split('?')[0].split('#')[0]  # 移除查询参数和锚点
    if '.' in url_path.split('/')[-1]:
        ext = '.' + url_path.split('.')[-1].lower()
        if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico']:
            return ext

    # 从 Content-Type 推断
    if content_type:
        type_map = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'image/bmp': '.bmp',
            'image/x-icon': '.ico',
        }
        for mime, ext in type_map.items():
            if mime in content_type:
                return ext

    return '.jpg'  # 默认扩展名


def replace_image_urls(html: str, url_mapping: dict[str, str]) -> str:
    """
    替换 HTML 中的图片 URL 为本地路径

    Args:
        html: 原始 HTML 字符串
        url_mapping: URL 到本地路径的映射

    Returns:
        替换后的 HTML 字符串
    """
    result = html
    for original_url, local_path in url_mapping.items():
        if local_path:  # 只替换下载成功的图片
            # 转义正则特殊字符
            escaped_url = re.escape(original_url)
            result = re.sub(escaped_url, local_path, result)
    return result


def build_url_mapping(task: ExportTask) -> dict[str, str]:
    """
    根据任务图片状态生成 URL 映射

    Args:
        task: 导出任务

    Returns:
        URL 到本地路径的映射
    """
    url_mapping: dict[str, str] = {}
    for image in task.images:
        if image.status == "downloaded" and image.filename:
            url_mapping[image.url] = image.filename
        else:
            if task.options.rewrite_failed_images == FailedImageStrategy.KEEP_REMOTE:
                url_mapping[image.url] = image.url
            else:
                url_mapping[image.url] = ""
    return url_mapping


def wrap_html_document(html: str) -> str:
    """
    为 HTML 添加基础文档结构

    Args:
        html: 处理后的 HTML 内容

    Returns:
        包含基础文档结构的完整 HTML
    """
    if html.strip().lower().startswith('<!doctype'):
        return html

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>离线内容</title>
    <style>
        body {{
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
        }}
        img {{
            max-width: 100%;
            height: auto;
        }}
    </style>
</head>
<body>
{html}
</body>
</html>"""


def create_problem_response(
    request: Request,
    status: int,
    title: str,
    detail: str,
    problem_type: str = "about:blank"
) -> JSONResponse:
    """创建 RFC 7807 格式的错误响应"""
    return JSONResponse(
        status_code=status,
        content={
            "type": problem_type,
            "title": title,
            "status": status,
            "detail": detail,
            "instance": str(request.url.path)
        },
        media_type="application/problem+json"
    )


async def download_single_image(
    client: httpx.AsyncClient,
    url: str,
    save_path: Path,
    index: int,
    total: int
) -> ImageInfo:
    """
    下载单张图片

    Args:
        client: httpx 异步客户端
        url: 图片 URL
        save_path: 保存目录路径
        index: 图片序号（从1开始）
        total: 图片总数（用于计算序号位数）

    Returns:
        图片信息对象
    """
    image_info = ImageInfo(url=url, status="downloading")

    # 配置请求头，模拟正常浏览器请求
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": url,
    }

    last_error: Optional[str] = None
    attempts_made = 0

    # 按重试次数循环，首次请求为第 0 次
    for attempt in range(IMAGE_DOWNLOAD_RETRY_COUNT + 1):
        attempts_made += 1
        try:
            # 发送 GET 请求
            response = await client.get(url, headers=headers, follow_redirects=True)
            response.raise_for_status()

            # 获取文件扩展名
            content_type = response.headers.get('content-type', '')
            ext = get_file_extension(url, content_type)

            # 生成简单序号命名：01.jpg, 02.jpg, ...
            # 根据图片总数决定补零位数
            pad_width = len(str(total)) if total > 0 else 2
            pad_width = max(pad_width, 2)  # 至少2位
            filename = f"{str(index).zfill(pad_width)}{ext}"
            file_path = save_path / filename

            # 保存文件
            file_path.write_bytes(response.content)

            # 更新图片信息
            image_info.filename = f"images/{filename}"
            image_info.status = "downloaded"
            image_info.size = len(response.content)
            image_info.retry_count = attempts_made
            return image_info

        except httpx.TimeoutException:
            last_error = "Download timeout"
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            last_error = f"HTTP {status_code}"
            # 对 429 和 5xx 才进行重试，其余错误直接终止
            if status_code < 500 and status_code != 429:
                break
        except httpx.RequestError as e:
            # 网络错误（DNS、连接断开等）
            last_error = f"Request error: {str(e)}"
        except Exception as e:
            last_error = str(e)
            break

        # 如果仍有重试机会，按次数递增等待再试
        if attempt < IMAGE_DOWNLOAD_RETRY_COUNT:
            await asyncio.sleep(IMAGE_DOWNLOAD_RETRY_DELAY * (attempt + 1))

    image_info.status = "failed"
    image_info.error = last_error or "Download failed"
    image_info.retry_count = attempts_made

    return image_info


async def process_export_task(task_id: str):
    """
    处理导出任务的后台协程

    Args:
        task_id: 导出任务 ID
    """
    task = export_tasks.get(task_id)
    if not task:
        return

    task.status = ExportStatus.PROCESSING

    try:
        # 创建任务专属的临时目录
        task_dir = EXPORT_TEMP_DIR / task_id
        task_dir.mkdir(exist_ok=True)
        images_dir = task_dir / "images"
        images_dir.mkdir(exist_ok=True)

        # 提取图片 URL（远程 + base64）
        data_image_urls = extract_data_images(task.html)
        image_urls = extract_image_urls(task.html)

        # 限制图片数量（优先保留 base64 图片）
        if len(data_image_urls) >= MAX_IMAGES_COUNT:
            data_image_urls = data_image_urls[:MAX_IMAGES_COUNT]
            image_urls = []
        else:
            remaining_slots = MAX_IMAGES_COUNT - len(data_image_urls)
            if len(image_urls) > remaining_slots:
                image_urls = image_urls[:remaining_slots]

        total_images = len(data_image_urls) + len(image_urls)
        task.stats.images_found = total_images
        task.progress.total = total_images

        # 初始化图片信息列表
        task.images = [ImageInfo(url=url) for url in data_image_urls + image_urls]

        # 下载图片
        if task.options.download_images and total_images:
            # 先处理 base64 图片
            for i, data_url in enumerate(data_image_urls):
                result = save_data_image(data_url, images_dir, i + 1, total_images)
                task.images[i] = result
                task.progress.done = i + 1

                if result.status == "downloaded":
                    task.stats.images_downloaded += 1
                    task.stats.total_size += result.size or 0
                else:
                    task.stats.images_failed += 1

            # 再处理远程图片
            async with httpx.AsyncClient(timeout=IMAGE_DOWNLOAD_TIMEOUT) as client:
                tasks = [
                    download_single_image(
                        client,
                        url,
                        images_dir,
                        i + 1 + len(data_image_urls),
                        total_images
                    )
                    for i, url in enumerate(image_urls)
                ]
                results = await asyncio.gather(*tasks)

                # 更新图片信息和统计
                for i, result in enumerate(results):
                    task_index = i + len(data_image_urls)
                    task.images[task_index] = result
                    task.progress.done = task_index + 1

                    if result.status == "downloaded":
                        task.stats.images_downloaded += 1
                        task.stats.total_size += result.size or 0
                    else:
                        task.stats.images_failed += 1

        # 替换 HTML 中的图片 URL
        url_mapping = build_url_mapping(task)
        processed_html = replace_image_urls(task.html, url_mapping)

        # 添加必要的 HTML 结构和 meta 标签
        processed_html = wrap_html_document(processed_html)

        # 写入 index.html
        index_path = task_dir / "index.html"
        index_path.write_text(processed_html, encoding='utf-8')

        # 缓存处理后的 HTML，供 document 接口直接返回
        task.processed_html = processed_html

        # 生成 manifest.json
        manifest = {
            "export_id": task_id,
            "mode": task.mode.value,
            "created_at": task.created_at.isoformat(),
            "images": [img.model_dump() for img in task.images],
            "stats": task.stats.model_dump()
        }
        manifest_path = task_dir / "manifest.json"
        import json
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

        # 创建 ZIP 文件
        zip_path = EXPORT_TEMP_DIR / f"{task_id}.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 添加 index.html
            zf.write(index_path, "index.html")
            # 添加 manifest.json
            zf.write(manifest_path, "manifest.json")
            # 添加所有图片
            for img_file in images_dir.iterdir():
                zf.write(img_file, f"images/{img_file.name}")

        # 清理临时目录（保留 ZIP）
        shutil.rmtree(task_dir)

        task.status = ExportStatus.COMPLETED

    except Exception as e:
        task.status = ExportStatus.FAILED
        task.error_message = str(e)


def cleanup_expired_tasks():
    """清理过期的任务和文件"""
    now = datetime.now(timezone.utc)
    expired_ids = []

    for task_id, task in export_tasks.items():
        if task.expires_at < now:
            expired_ids.append(task_id)
            # 删除对应的 ZIP 文件
            zip_path = EXPORT_TEMP_DIR / f"{task_id}.zip"
            if zip_path.exists():
                zip_path.unlink()
            # 删除临时目录（如果存在）
            task_dir = EXPORT_TEMP_DIR / task_id
            if task_dir.exists():
                shutil.rmtree(task_dir)

    # 从内存中移除过期任务
    for task_id in expired_ids:
        del export_tasks[task_id]

    # 清理已过期任务对应的幂等键
    if expired_ids:
        for key, task_id in list(idempotency_records.items()):
            if task_id in expired_ids:
                del idempotency_records[key]


async def perform_retry_images(task: ExportTask, retry_indices: list[int]) -> dict:
    """
    执行失败图片重试并重建导出文件

    Args:
        task: 导出任务
        retry_indices: 需要重试的图片索引列表

    Returns:
        更新后的 manifest 内容
    """
    zip_path = EXPORT_TEMP_DIR / f"{task.id}.zip"
    if not zip_path.exists():
        raise FileNotFoundError(f"Archive file for '{task.id}' not found")

    task.status = ExportStatus.PROCESSING
    task.progress.total = len(retry_indices)
    task.progress.done = 0

    # 重建任务临时目录
    task_dir = EXPORT_TEMP_DIR / task.id
    images_dir = task_dir / "images"
    if task_dir.exists():
        shutil.rmtree(task_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    # 从已有 ZIP 中解压已下载图片，避免重复下载
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for file_name in zf.namelist():
            if file_name.startswith("images/") and not file_name.endswith("/"):
                zf.extract(file_name, task_dir)

    total_images = len(task.images)

    # 仅重试指定索引的图片
    async with httpx.AsyncClient(timeout=IMAGE_DOWNLOAD_TIMEOUT) as client:
        retry_tasks = []
        retry_positions = []

        for index in retry_indices:
            image = task.images[index]
            position = index + 1
            retry_positions.append((index, position))

            if image.url.startswith("data:image"):
                retry_tasks.append(None)
            else:
                retry_tasks.append(
                    download_single_image(client, image.url, images_dir, position, total_images)
                )

        # 逐个执行以更新进度
        results = []
        for task_item, (index, position) in zip(retry_tasks, retry_positions):
            if task_item is None:
                result = save_data_image(
                    task.images[index].url,
                    images_dir,
                    position,
                    total_images
                )
            else:
                result = await task_item
            results.append((index, result))
            task.progress.done += 1

    # 更新失败图片信息
    for index, result in results:
        task.images[index] = result

    # 重新生成处理后的 HTML
    url_mapping = build_url_mapping(task)
    processed_html = replace_image_urls(task.html, url_mapping)
    processed_html = wrap_html_document(processed_html)

    # 写入 index.html
    index_path = task_dir / "index.html"
    index_path.write_text(processed_html, encoding='utf-8')

    # 更新图片大小统计
    for image in task.images:
        if image.filename:
            file_path = task_dir / image.filename
            if file_path.exists():
                image.size = file_path.stat().st_size

    # 重算统计
    task.stats.images_found = len(task.images)
    task.stats.images_downloaded = len([img for img in task.images if img.status == "downloaded"])
    task.stats.images_failed = len([img for img in task.images if img.status == "failed"])
    task.stats.total_size = sum(img.size or 0 for img in task.images if img.status == "downloaded")

    # 生成 manifest.json
    manifest = {
        "export_id": task.id,
        "mode": task.mode.value,
        "created_at": task.created_at.isoformat(),
        "images": [img.model_dump() for img in task.images],
        "stats": task.stats.model_dump()
    }
    manifest_path = task_dir / "manifest.json"
    import json
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

    # 重新创建 ZIP 文件
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(index_path, "index.html")
        zf.write(manifest_path, "manifest.json")
        for img_file in images_dir.iterdir():
            zf.write(img_file, f"images/{img_file.name}")

    # 清理临时目录（保留 ZIP）
    shutil.rmtree(task_dir)

    # 更新任务缓存的 HTML
    task.processed_html = processed_html
    task.status = ExportStatus.COMPLETED

    return manifest


# ==================== API 路由 ====================

@app.get("/api/v1/health", response_model=HealthResponse, tags=["健康检查"])
async def health_check():
    """健康检查接口"""
    uptime = int((datetime.now(timezone.utc) - app_start_time).total_seconds())
    return HealthResponse(status="healthy", version="1.0.0", uptime=uptime)


@app.post("/api/v1/exports", status_code=202, tags=["导出"])
async def create_export(
    request: Request,
    body: CreateExportRequest,
    background_tasks: BackgroundTasks
):
    """
    创建导出任务

    接收清洗后的 HTML 内容，创建异步导出任务进行图片下载和打包。
    """
    # 获取幂等键（用于避免重复创建任务）
    idempotency_key = request.headers.get("Idempotency-Key")

    # 检查 HTML 大小
    if len(body.html.encode('utf-8')) > MAX_HTML_SIZE:
        return create_problem_response(
            request, 422, "Payload Too Large",
            f"HTML content exceeds maximum size of {MAX_HTML_SIZE} bytes",
            "https://blog-ueditor.example.com/problems/payload-too-large"
        )

    # 清理过期任务
    cleanup_expired_tasks()

    # 命中幂等键：直接返回已有任务（未过期时生效）
    if idempotency_key:
        existing_task_id = idempotency_records.get(idempotency_key)
        if existing_task_id:
            existing_task = export_tasks.get(existing_task_id)
            if existing_task and datetime.now(timezone.utc) <= existing_task.expires_at:
                return JSONResponse(
                    status_code=202,
                    content={
                        "id": existing_task.id,
                        "status": existing_task.status.value,
                        "created_at": existing_task.created_at.isoformat(),
                        "expires_at": existing_task.expires_at.isoformat(),
                        "links": {
                            "self": existing_task.links.self_link,
                            "archive": existing_task.links.archive,
                            "manifest": existing_task.links.manifest
                        }
                    },
                    headers={"Location": f"/api/v1/exports/{existing_task.id}"}
                )
            # 过期或丢失则清理幂等键
            idempotency_records.pop(idempotency_key, None)

    # 创建任务
    task_id = generate_export_id()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=EXPORT_EXPIRY_SECONDS)

    task = ExportTask(
        id=task_id,
        status=ExportStatus.QUEUED,
        created_at=now,
        expires_at=expires_at,
        links=ExportLinks(
            self=f"/api/v1/exports/{task_id}",
            archive=f"/api/v1/exports/{task_id}/archive",
            manifest=f"/api/v1/exports/{task_id}/manifest"
        ),
        mode=body.mode,
        html=body.html,
        options=body.options or ExportOptions()
    )

    export_tasks[task_id] = task

    # 记录幂等键与任务 ID 的映射
    if idempotency_key:
        idempotency_records[idempotency_key] = task_id

    # 在后台启动处理任务
    background_tasks.add_task(process_export_task, task_id)

    # 返回响应
    return JSONResponse(
        status_code=202,
        content={
            "id": task.id,
            "status": task.status.value,
            "created_at": task.created_at.isoformat(),
            "expires_at": task.expires_at.isoformat(),
            "links": {
                "self": task.links.self_link,
                "archive": task.links.archive,
                "manifest": task.links.manifest
            }
        },
        headers={"Location": f"/api/v1/exports/{task_id}"}
    )


@app.get("/api/v1/exports/{export_id}", tags=["导出"])
async def get_export_status(request: Request, export_id: str):
    """查询导出任务状态"""
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    # 检查是否过期
    if datetime.now(timezone.utc) > task.expires_at:
        task.status = ExportStatus.EXPIRED

    return {
        "id": task.id,
        "status": task.status.value,
        "progress": task.progress.model_dump() if task.status == ExportStatus.PROCESSING else None,
        "stats": task.stats.model_dump() if task.status in [ExportStatus.PROCESSING, ExportStatus.COMPLETED] else None,
        "created_at": task.created_at.isoformat(),
        "expires_at": task.expires_at.isoformat(),
        "links": {
            "self": task.links.self_link,
            "archive": task.links.archive,
            "manifest": task.links.manifest
        },
        "error": task.error_message if task.status == ExportStatus.FAILED else None
    }


@app.get("/api/v1/exports/{export_id}/archive", tags=["导出"])
async def download_archive(request: Request, export_id: str):
    """下载导出的 ZIP 文件"""
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    # 检查是否过期
    if datetime.now(timezone.utc) > task.expires_at:
        task.status = ExportStatus.EXPIRED
        return create_problem_response(
            request, 410, "Gone",
            f"Export task '{export_id}' has expired",
            "https://blog-ueditor.example.com/problems/expired"
        )

    # 检查任务状态
    if task.status == ExportStatus.PROCESSING or task.status == ExportStatus.QUEUED:
        return create_problem_response(
            request, 409, "Conflict",
            f"Export task '{export_id}' is still processing",
            "https://blog-ueditor.example.com/problems/processing"
        )

    if task.status == ExportStatus.FAILED:
        return create_problem_response(
            request, 500, "Export Failed",
            task.error_message or "Unknown error occurred during export",
            "https://blog-ueditor.example.com/problems/export-failed"
        )

    # 返回 ZIP 文件
    zip_path = EXPORT_TEMP_DIR / f"{export_id}.zip"
    if not zip_path.exists():
        return create_problem_response(
            request, 404, "Not Found",
            f"Archive file for '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    return FileResponse(
        path=str(zip_path),
        filename=f"blog-ueditor-{export_id}.zip",
        media_type="application/zip"
    )


@app.get("/api/v1/exports/{export_id}/manifest", tags=["导出"])
async def get_manifest(request: Request, export_id: str):
    """获取导出任务的 manifest 信息"""
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    if task.status not in [ExportStatus.COMPLETED, ExportStatus.PROCESSING]:
        return create_problem_response(
            request, 409, "Conflict",
            f"Manifest not available for task in '{task.status.value}' status",
            "https://blog-ueditor.example.com/problems/conflict"
        )

    return {
        "export_id": task.id,
        "mode": task.mode.value,
        "created_at": task.created_at.isoformat(),
        "images": [img.model_dump() for img in task.images],
        "stats": task.stats.model_dump()
    }


@app.post("/api/v1/exports/{export_id}/retry-images", tags=["导出"])
async def retry_failed_images(request: Request, export_id: str):
    """
    仅重试下载失败的图片

    会在成功后重建 ZIP 与 manifest，并更新导出任务的图片状态。
    """
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )
    if datetime.now(timezone.utc) > task.expires_at:
        task.status = ExportStatus.EXPIRED
        return create_problem_response(
            request, 410, "Gone",
            f"Export task '{export_id}' has expired",
            "https://blog-ueditor.example.com/problems/expired"
        )

    if task.status != ExportStatus.COMPLETED:
        return create_problem_response(
            request, 409, "Conflict",
            f"Retry not available for task in '{task.status.value}' status",
            "https://blog-ueditor.example.com/problems/conflict"
        )

    # 找出失败的图片索引
    failed_indices = [
        index for index, image in enumerate(task.images)
        if image.status == "failed"
    ]

    if not failed_indices:
        return {
            "export_id": task.id,
            "mode": task.mode.value,
            "created_at": task.created_at.isoformat(),
            "images": [img.model_dump() for img in task.images],
            "stats": task.stats.model_dump()
        }

    try:
        manifest = await perform_retry_images(task, failed_indices)
        return manifest
    except FileNotFoundError:
        return create_problem_response(
            request, 404, "Not Found",
            f"Archive file for '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )
    except Exception as e:
        task.status = ExportStatus.FAILED
        task.error_message = str(e)
        return create_problem_response(
            request, 500, "Retry Failed",
            task.error_message or "Failed to retry images",
            "https://blog-ueditor.example.com/problems/retry-failed"
        )


@app.post("/api/v1/exports/{export_id}/retry-image", tags=["导出"])
async def retry_single_image(request: Request, export_id: str, body: RetryImageRequest):
    """
    重试单张失败图片

    Args:
        export_id: 导出任务 ID
        body: 重试请求体（包含图片 URL）
    """
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    if datetime.now(timezone.utc) > task.expires_at:
        task.status = ExportStatus.EXPIRED
        return create_problem_response(
            request, 410, "Gone",
            f"Export task '{export_id}' has expired",
            "https://blog-ueditor.example.com/problems/expired"
        )

    if task.status != ExportStatus.COMPLETED:
        return create_problem_response(
            request, 409, "Conflict",
            f"Retry not available for task in '{task.status.value}' status",
            "https://blog-ueditor.example.com/problems/conflict"
        )

    try:
        target_index = next(
            index for index, image in enumerate(task.images)
            if image.url == body.url
        )
    except StopIteration:
        return create_problem_response(
            request, 404, "Not Found",
            "Target image not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    if task.images[target_index].status != "failed":
        return create_problem_response(
            request, 409, "Conflict",
            "Target image is not in failed status",
            "https://blog-ueditor.example.com/problems/conflict"
        )

    try:
        manifest = await perform_retry_images(task, [target_index])
        return manifest
    except FileNotFoundError:
        return create_problem_response(
            request, 404, "Not Found",
            f"Archive file for '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )
    except Exception as e:
        task.status = ExportStatus.FAILED
        task.error_message = str(e)
        return create_problem_response(
            request, 500, "Retry Failed",
            task.error_message or "Failed to retry image",
            "https://blog-ueditor.example.com/problems/retry-failed"
        )


@app.get("/api/v1/exports/{export_id}/document", tags=["导出"])
async def get_export_document(request: Request, export_id: str):
    """
    获取导出任务的最终 HTML

    仅在任务完成后返回处理后的 HTML 内容。
    """
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    if task.status != ExportStatus.COMPLETED:
        return create_problem_response(
            request, 409, "Conflict",
            f"Document not available for task in '{task.status.value}' status",
            "https://blog-ueditor.example.com/problems/conflict"
        )

    if not task.processed_html:
        return create_problem_response(
            request, 404, "Not Found",
            f"Document for '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    from fastapi.responses import Response
    return Response(
        content=task.processed_html,
        media_type="text/html; charset=utf-8"
    )


@app.delete("/api/v1/exports/{export_id}", status_code=204, tags=["导出"])
async def delete_export(request: Request, export_id: str):
    """删除/取消导出任务"""
    task = export_tasks.get(export_id)

    if not task:
        return create_problem_response(
            request, 404, "Not Found",
            f"Export task '{export_id}' not found",
            "https://blog-ueditor.example.com/problems/not-found"
        )

    # 删除 ZIP 文件
    zip_path = EXPORT_TEMP_DIR / f"{export_id}.zip"
    if zip_path.exists():
        zip_path.unlink()

    # 删除临时目录
    task_dir = EXPORT_TEMP_DIR / export_id
    if task_dir.exists():
        shutil.rmtree(task_dir)

    # 从内存中移除
    del export_tasks[export_id]

    return None


# ==================== 图片代理接口 ====================

@app.get("/api/v1/proxy-image", tags=["图片代理"])
async def proxy_image(request: Request, url: str):
    """
    图片代理下载接口

    用于绕过浏览器的 CORS 和防盗链限制，通过后端下载图片。
    前端可以通过此接口下载单张图片。

    Args:
        url: 图片的原始 URL
    """
    if not url:
        return create_problem_response(
            request, 400, "Bad Request",
            "Missing 'url' parameter",
            "https://blog-ueditor.example.com/problems/bad-request"
        )

    try:
        # 配置请求头，模拟正常浏览器请求
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": url,  # 使用图片 URL 作为 Referer
        }

        async with httpx.AsyncClient(timeout=IMAGE_DOWNLOAD_TIMEOUT) as client:
            response = await client.get(url, headers=headers, follow_redirects=True)
            response.raise_for_status()

            # 获取内容类型
            content_type = response.headers.get('content-type', 'image/jpeg')

            # 获取文件扩展名用于文件名
            ext = get_file_extension(url, content_type)
            # 生成文件名（使用 URL 的 hash）
            url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
            filename = f"image_{url_hash}{ext}"

            # 返回图片内容，设置为附件下载
            from fastapi.responses import Response
            return Response(
                content=response.content,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "public, max-age=3600"
                }
            )

    except httpx.TimeoutException:
        return create_problem_response(
            request, 504, "Gateway Timeout",
            "Image download timeout",
            "https://blog-ueditor.example.com/problems/timeout"
        )
    except httpx.HTTPStatusError as e:
        return create_problem_response(
            request, 502, "Bad Gateway",
            f"Failed to download image: HTTP {e.response.status_code}",
            "https://blog-ueditor.example.com/problems/download-failed"
        )
    except Exception as e:
        return create_problem_response(
            request, 500, "Internal Server Error",
            f"Failed to download image: {str(e)}",
            "https://blog-ueditor.example.com/problems/internal-error"
        )


# ==================== 静态文件托管（生产环境） ====================

# 如果 static 目录存在，则挂载静态文件服务
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

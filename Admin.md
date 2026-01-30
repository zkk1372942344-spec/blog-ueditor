blog-ueditor 富文本清洗与离线导出工具开发方案

项目简介与目标功能列表

项目名称：blog-ueditor – 基于 UEditor 的富文本清洗与离线导出工具。该工具旨在帮助用户将从 秀米 等编辑器复制的富文本内容进行清理，并打包成可离线浏览的网页包。主要目标和功能包括：
•	富文本内容清洗：用户在浏览器中通过 UEditor 粘贴富文本 HTML 内容后，工具自动/手动清理其中多余的样式和标签，保证输出 HTML 纯净度约 80%（提供 Safe 模式和 Aggressive 模式两种清洗级别）。Safe 模式在移除恶意或无用代码的同时尽可能保留版式；Aggressive 模式进一步精简内容，去除大部分样式，只保留基础结构和文本格式。
•	图片资源提取与本地化：扫描内容中所有图片来源，包括 <img> 标签的 src 属性和行内样式中的 background-image URL，将这些远程图片下载到本地。如果图片可正常下载，则保存至本地 images/ 目录；若图片无法下载（例如权限或网络原因），则记录下载失败并在最终内容中保留其外链引用。
•	内容引用更新：在清理后的 HTML 中，将所有图片的引用路径替换为本地路径（如 images/xxx.png），确保脱机环境下图片也能加载。
•	一键离线包导出：提供导出功能，生成包含 index.html（清洗后的内容）、images/ 子目录（保存的所有图片）以及 manifest.json 文件（资源清单和元信息）的 zip 压缩包，供用户下载保存。一键打包后，用户无需依赖任何外部资源即可离线打开 index.html 查看内容。

通过上述功能，blog-ueditor 实现将外部富文本内容本地化和纯净化的目标——例如，将秀米文章所引用的远程图片拉取至本地，并清理冗余的 SVG 属性或样式，以获得可离线预览的纯净结构 ￼。该工具预期主要应用于博客或文档场景，方便用户保存内容备份或进行内容迁移。

技术架构图与目录结构建议

总体架构：采用前后端分离的 Web 架构，前端提供基于浏览器的富文本编辑及预览交互，后端提供图片下载和打包等服务。技术栈包括 React + TypeScript + Vite 前端和 FastAPI + Python 3.13 + httpx 后端，两者通过 HTTP 接口交互。后端同时托管前端静态资源，使部署和访问更为简单（在宝塔环境下一并部署）。

架构流程示意：
•	用户浏览器 (前端)：运行 React 单页应用，嵌入 UEditor 富文本编辑器。用户将外部内容（如秀米 HTML）粘贴到编辑器中。前端执行本地的 HTML 清洗和图片 URL 提取逻辑，然后调用后端 API。
•	FastAPI 服务 (后端)：接收前端发送的清洗后 HTML 和图片链接列表，利用 httpx 异步并发下载图片 ￼、生成离线 HTML 和资源文件（包括构建资源清单 manifest），最后打包成 zip 返回给前端。后端也通过 StaticFiles 中间件托管前端静态文件，使用户直接访问 Web 页面 ￼。
•	本地文件存储：后端在服务器临时目录保存下载的图片和生成的 HTML/manifest，再通过 FastAPI 的 FileResponse 将 zip 文件流发送给用户下载。下载完成后，后台任务删除临时文件，避免占用存储 ￼。

上述架构既保证了前端的良好交互体验，又利用后端能力处理跨域图片下载和文件打包，分工明确。技术架构图如下（文本示意）：

[ 用户浏览器：React + UEditor ]
│  粘贴富文本 HTML
▼
前端：清洗 HTML、提取图片 → 显示预览
│  调用导出API (发送HTML及图片列表)
▼
后端：FastAPI 接口
- 异步下载图片 (httpx)
- 构建纯净 index.html
- 生成 manifest.json
- 打包 images/ 与文件为 ZIP
│  返回 ZIP 文件下载
▼
用户获得 blog-ueditor.zip（内含 index.html + images/ + manifest.json）

代码目录结构建议：为了清晰组织前后端代码，可采用以下项目结构：

blog-ueditor/
├── frontend/               # 前端React项目
│   ├── src/                # 源码（React组件、清洗逻辑等）
│   ├── public/             # 公共资源目录（可放UEditor静态文件等）
│   ├── index.html          # 应用入口HTML（Vite模板）
│   └── vite.config.ts      # Vite配置
├── backend/                # 后端FastAPI项目
│   ├── app.py              # FastAPI 应用主文件（启动、路由挂载等）
│   ├── requirements.txt    # 后端依赖（FastAPI, httpx 等）
│   ├── static/             # 前端构建后的静态文件（用于托管）
│   │   └── index.html      # 前端打包生成的文件
│   ├── images/             # 临时图片保存目录（导出时动态创建）
│   ├── templates/          # （可选）模板文件目录
│   └── ... 其他模块 ...
└── README.md               # 项目说明文档

在部署时，前端使用 Vite 打包（例如输出到 /dist），然后将打包产物拷贝或部署至后端的 static/ 目录下。FastAPI 将 /static 路径挂载到该目录，用于提供前端页面访问 ￼ ￼。也可以直接将前端构建结果放在后端根目录并通过 app.mount("/", StaticFiles(directory='static', html=True)) 将根路径指向单页应用 ￼。这样，用户访问服务器域名时即返回前端应用的 index.html，由前端路由和逻辑处理一切交互，而后端负责 API 请求。

前端模块设计

前端采用 React + TypeScript 实现，主要模块包括富文本编辑器集成、内容清洗、图片提取，以及预览与导出控制。各模块设计如下：
•	富文本输入模块（UEditor 集成）：在 React 中引入百度 UEditor 编辑器，实现富文本内容的输入和基本编辑。由于 UEditor 并非原生 React 组件，需在前端公共资源中包含其 JS 和配置文件，并在组件加载时手动初始化编辑器实例 ￼。具体方式：将 UEditor 发布版（例如 ueditor.all.js、ueditor.config.js 以及语言文件、主题等）放入 public/ueditor/ 目录，确保构建后可通过 /ueditor/ 路径访问。然后在 public/index.html 中用 <script> 标签引入 UEditor脚本 ￼。在 React 组件中，使用 useEffect 钩子在组件挂载时初始化 UEditor，例如：

useEffect(() => {
// 创建UEditor实例并挂载到指定DOM容器
const ue = window.UE.getEditor('editorContainer', {
initialFrameHeight: 400, initialFrameWidth: '100%',
autoFloatEnabled: false /* 禁用工具栏浮动 */,
// ... 其他配置如工具栏定制等
});
// 可选：监听UEditor的粘贴事件或内容变化事件
ue.addListener('afterpaste', () => {
// 触发自动清洗或提示用户清洗
});
// 清理：组件卸载时销毁编辑器实例
return () => ue.destroy();
}, []);

该模块提供一个编辑器容器（如 <div id="editorContainer"></div>）供 UEditor 实例挂载，封装方法供父组件获取编辑内容。例如，通过 ue.getContent() 获取 HTML 字符串 ￼。此模块还可以自定义 UEditor 配置以精简不需要的功能按钮，并设置粘贴纯文本等选项（避免富文本粘贴时过多不必要格式）。

	•	内容清洗逻辑模块：负责将粘贴到编辑器中的 HTML 内容进行过滤清理，根据 Safe 或 Aggressive 模式执行不同强度的清理。实现上有两种方案：
	1.	在前端实时清洗：监听用户粘贴事件（UEditor 的 afterpaste 回调）或在用户点击“清洗”按钮时，从 UEditor 获取 HTML 内容字符串，通过 DOM 操作或正则对内容进行过滤，然后将清理后的内容重新写回编辑器或供预览使用。
	2.	利用成熟库：结合 DOMPurify 等前端库进行 HTML sanitization，在 Safe 模式下去除明显危险或冗余的标签属性（如<script>、事件属性on*等），Aggressive 模式下进一步剥除样式和无关属性，仅保留基本结构和文本。
为满足“纯净度约 80%”的要求，可针对秀米生成的 HTML 特点定制清洗规则：
•	Safe 模式：删除任何脚本、iframe等不安全元素；移除样式表<style>或外链CSS引用；清理与排版无关的冗余属性（如数据属性、元素的id/class如果特定于秀米模板且无用）；保留必要的 inline 样式用于呈现主要的版式，但可考虑去除固定宽高、超出范围的字体格式等，以增强内容适应性。比如秀米有时会在元素上添加大量style用于精确定位，在Safe模式下可选择性保留段落和文本的样式（如加粗、颜色）但删除多余的定位或透明度样式。
•	Aggressive 模式：在 Safe 的基础上进一步去除所有内联样式和类名，只保留基本的内容结构标签（段落<p>、标题<h*>、列表<ul><li>等）和文本/图片元素。这相当于获取内容的“纯文本+基础格式”形态，确保HTML极度简洁。Aggressive模式可能会改变原有排版（例如所有文字恢复默认样式）但能最大程度保证内容纯净。该模式下，也可以移除所有不必要的容器<div>，只保留语义标签，从而提高纯净度。
清洗逻辑可以使用 正则表达式 结合 DOM Parser 来实现。例如，先使用 DOM Parser 将 HTML 字符串转换为 DOM 树，递归遍历删除不允许的节点和属性；或者简单方式，通过一系列正则替换规则完成（先替换删除整段脚本/样式等标签，然后针对标签属性进行模式替换）。参考做法如：用正则移除所有内联 style 属性 ￼或指定的 SVG 冗余属性 ￼等。
最终清洗输出的 HTML 字符串将近似达到要求的纯净程度（不追求100%无多余代码，但显著简化）。我们可以将清洗后的内容不直接渲染到编辑器（以免 UEditor 再次添加格式），而是用于预览模块或直接发送给后端导出接口。
•	图片提取模块：扫描当前编辑内容中所有图片资源链接。在用户粘贴内容后或点击“导出”时运行此模块，解析 HTML 找出 <img> 标签的 src 和所有行内样式中包含 background-image:url(...) 的图片 URL。由于前端有完整 DOM，可直接使用 DOM API 查找：
•	方法1：document.querySelectorAll('img') 获取所有图片元素，收集其 .src 属性。
•	方法2：查找行内样式：可以遍历所有元素的 style 属性或使用正则匹配 HTML 字符串中 background-image。例如正则模式：/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i 提取出样式中的URL。
也可以复用与后端相同的匹配逻辑，以确保前后识别一致。参考某项目的做法：用单一正则同时捕获 <img ... src="..."> 和 background-image:url("...") 两种情况，然后提取链接 ￼。前端提取后，会得到一个图片URL列表。去重：有时相同图片可能出现多次引用，应当去重以避免重复下载。
提取出的 URL 列表将用于后端下载。如果图片是 base64 内嵌（data URI），前端可标记这些无需下载，但应该考虑转换为文件（可选）。基本流程：前端调用后端图片下载 API 时将此列表传递。图片提取模块也可在 UI 上显示统计，例如“发现 X 张图片，将进行本地化”。
•	预览与导出模块：提供给用户在清洗之后、导出之前预览结果，以及一键导出的交互。预览部分可以通过一个预览面板来展示清洗后的 HTML 内容渲染效果：实现时可在React中创建一个预览组件，直接将清理后的 HTML 字符串插入 dangerouslySetInnerHTML，或在一个 iframe 中加载，以模拟最终离线页面的样式效果（在大部分情况下，默认浏览器样式即可）。预览确保用户在导出前看到内容的大致样貌，特别是在 Aggressive 模式下可能样式损失较多，预览能让用户确认是否接受。
导出部分：前端提供一个“导出 ZIP”按钮。点击后执行以下流程：
1.	确定当前使用的清洗模式，获取相应清洗后的 HTML字符串（如果之前未自动清洗则此时进行）。
2.	触发调用后端导出 API，将 HTML 字符串和图片 URL 列表作为请求数据发送到服务器。
3.	等待服务器处理并返回打包文件。返回结果可能是一个文件下载流或文件下载的URL。前端接收到响应后，引导用户下载 zip（如果是直接文件流，可利用浏览器下载；或提供下载链接）。
用户体验：导出时可展示加载状态或进度提示（如“正在下载图片并打包，请稍候…”）。若某些图片下载失败，后端会在 manifest.json 中记录，前端在获取结果后可提示用户“部分图片未能下载，已保留外链”。预览模块在导出后也可以提供一个“打开离线包”模拟测试（例如用户下载后可拖入浏览器，本工具不直接负责，但可在文档中提示如何使用manifest等）。
整个前端模块注重交互简洁：用户主要操作是粘贴->清洗->导出，一键完成。当然，也应提供模式切换和预览确认的步骤以保证结果符合预期。

后端模块设计

后端基于 FastAPI (Python 3.13) 实现，负责关键的图片下载、本地化替换、manifest生成和 zip 打包等。模块设计与接口划分如下：
•	图片下载接口：提供一个 API（如 POST /api/download_images）用于批量下载前端传来的图片URL列表。考虑到完全在导出接口中也可以处理图片下载，该接口可以是内部功能模块，也可以单独开放用于测试。主要逻辑：
1.	接收 JSON 请求，包含一个图片URL数组。例如：{"urls": ["http://...1.jpg", "http://...2.png", ...]}。
2.	利用 httpx 库的异步客户端并发请求每个 URL 以下载图片内容 ￼。可以使用 async with httpx.AsyncClient() 创建客户端，并对 URL 列表发起并发 GET 请求（通过 await asyncio.gather(*tasks) 聚合）。每个任务需设置合理的超时和异常处理。如果某个URL获取失败（抛异常或非200状态），记录失败原因。
3.	对于下载成功的图片，将其字节内容保存到后端文件系统的临时目录（如 backend/images/）。文件命名策略：可采用顺序编号或基于 URL 的哈希/文件名。【推荐】使用统一命名避免中文或特殊字符问题，例如按顺序命名为 1.jpg, 2.png, ...。也可以保留原扩展名方便识别 ￼ ￼。需要确保文件名唯一，可通过编号或UUID避免冲突。
4.	返回下载结果给前端，包括每个图片的新本地文件名或失败信息。例如：{"results": [{"url": "...1.jpg", "saved": "1.jpg"}, {"url": "...2.png", "saved": null, "error": "timeout"}]}。这样前端知晓哪些下载失败。如果此接口与导出整合，也可不单独返回结果，而是在生成离线包过程中处理失败情况。
然而，在本项目中，我们也可以不提供独立的下载API，而是将下载逻辑整合进导出接口中一步完成（因为用户最终需求是拿到整个包）。为了设计清晰，这里说明独立模块，但最终实现时导出接口会直接调用图片下载逻辑。
•	导出（打包）接口：这是核心接口，例如 POST /api/export，完成从清洗HTML到打包ZIP的所有步骤：
•	请求：接收 JSON 数据，包括清洗后的 HTML 字符串、图片URL列表、以及（可选）清洗模式或其他元信息。例如：

{
"html": "<!DOCTYPE html><html>...清洗后的内容...</html>",
"images": [
"http://example.com/abc.png",
"https://other.com/bg.jpg"
],
"mode": "safe"
}

（mode 字段可选，供后台记录或处理特殊情况。）

	•	处理流程：
	1.	解析请求数据：获取 HTML 内容字符串和图片URL列表。如果列表缺失，后端可自行从 HTML 中再提取一次确保不遗漏（使用和前端类似的正则/解析方法 ￼）。这种双保险也防止前端提取错误导致遗漏。
	2.	图片下载：调用内部的图片下载模块逻辑。对每个图片URL尝试下载，保存文件。如果某些失败，记录其 URL 列表备用。这里重用前述 httpx 并发下载实现，充分利用 FastAPI 异步性能，在几秒内下载大量图片 ￼。成功下载的图片保存在如 ./images/temp_<uuid>/临时目录（可按导出请求创建唯一子目录存放，防止并发混乱）。例如，用请求时间戳或 UUID 创建目录。若使用uuid文件名或序号，则需记录原始URL与本地文件名的映射。
	3.	替换HTML中的图片链接：使用与前端类似的替换逻辑，将 HTML 内容中的每个图片URL替换为对应的本地路径。例如所有 <img src="...original..."> 改为 <img src="images/1.jpg"> 之类 ￼；CSS背景图片 url("...") 改为 url("images/2.png") 等 ￼。此处可借助正则替换或解析DOM后修改属性再序列化 HTML。需要用之前保存的映射确保正确替换：按URL顺序或名称对应。如果某些图片下载失败且决定保留外链，则那些 URL 不替换，让其仍指向原地址，并在manifest中标记。
	4.	生成 manifest.json：构建一个 JSON 对象，记录本次导出的元数据，包括：
	•	images 列表：每项包含原始URL、对应保存的文件名（如果下载成功）或标记为空/失败原因。比如：

"images": [
{"url": "http://.../abc.png", "filename": "1.png", "status": "downloaded"},
{"url": "http://.../def.jpg", "filename": null, "status": "failed"}
]


	•	mode：本次清洗模式 (“safe” 或 “aggressive”)。
	•	timestamp：导出时间，或其它需要记录的信息（如版本号等）。
该 manifest.json 有助于使用者了解哪些资源本地化成功，以及内容生成时的设置。

	5.	准备打包文件：将替换后的 HTML 字符串写入临时目录下的 index.html 文件。确保在 <head> 部分设置合适的 <meta charset="UTF-8"> 等，以免中文乱码。把下载的所有图片文件已经在 images/子目录。将 manifest.json 内容写入文件放在临时目录根。此时临时目录结构形如：

temp_123456/
├─ index.html
├─ manifest.json
└─ images/
├─ 1.png
├─ 2.jpg
└─ ...


	6.	压缩打包：使用 Python 标准库 shutil.make_archive 或 zipfile 将上述目录打包为 ZIP 文件。例如生成 blog-ueditor-export.zip。文件名可以包含日期或随机串防止冲突。也可以直接用临时目录名 .zip。注意打包时目录层级，要保证 zip 内直接看到 index.html 等文件（可以在打包时设置根目录）。
	7.	响应：通过 FileResponse 将zip文件发送给前端下载。FastAPI 提供 FileResponse(path, filename="xxx.zip", background=...) 简便返回文件 ￼。其中可以利用 background 参数注册一个任务在响应完成后删除临时文件及目录 ￼。例如：

return FileResponse(zip_path, filename="blog-ueditor.zip",
background=BackgroundTask(lambda: shutil.rmtree(temp_dir)))

如此，请求完成时后台自动清理临时目录，避免服务端存留过多文件。

	•	错误处理：如果下载或打包过程中出现异常（如某图片URL阻塞很久或HTML解析错误），后端应返回相应的错误信息和状态码（HTTP 500等）给前端，并保证清理已创建的临时文件。对于部分图片下载失败的非致命情况，仍然可以成功生成zip，只是 manifest 中记录失败项，同时 HTTP 响应状态可以是200，并由前端提示用户检查manifest。
此导出接口相对独立，调用它即可完成所有资源的本地化打包工作。由于使用异步IO，即使较多图片也能较快完成下载 ￼。如有必要，可限制并发数量或采用 httpx 的连接池配置以防打包服务器带宽瓶颈。

	•	manifest 构建模块：如上所述，manifest的生成逻辑封装在导出过程中。这里强调 manifest 内容结构与用途。manifest.json 是一个清单和记录文件，可以用于：
	•	标明离线包包含的资源（文件列表、对应原URL）。
	•	提供给开发者或用户了解导出结果（哪些图片失败需手工处理）。
	•	未来如果要增量更新内容，可以依据 manifest 对比更新（当前版本仅静态用途）。
manifest 模块设计成简单函数，根据输入的原始URL列表和下载结果列表生成 JSON 对象并写文件。
•	文件管理模块：负责临时文件和静态资源的管理。由于后端需要托管前端静态文件以及在运行时生成临时导出文件，我们需要处理好文件路径和清理：
•	静态前端文件：FastAPI 可通过 app.mount("/static", StaticFiles(directory="static"), name="static") 托管前端资源 ￼。这些文件由前端构建后手动/自动部署到 backend/static 下。一旦部署，这部分通常不变（除非前端有更新）。
•	临时导出文件：每次导出创建一个临时目录放置 index.html、images 等。采用唯一目录名避免冲突（如 temp_<UUID>）。可以统一放置于 backend 下的某路径（如 backend/export_temp/）。当 FileResponse发送zip时，通过 background task 删除该目录 ￼。如果因异常未走到FileResponse，也要确保删除，可在异常处理时调用清理函数。文件管理模块可以设计一个辅助类，比如 ExportManager：

class ExportManager:
BASE_PATH = Path("./export_temp")
def __init__(self):
# create base directory if not exist
def create_session_dir(self): -> Path
# generate unique directory
def cleanup(self, path: Path):
# remove given directory

这样组织代码，确保每次导出有始有终的文件操作。不使用长久保存，无需数据库，所有导出产物在下载后即删除，保证服务器空间。
另一个考虑是并发与权限：多个用户同时导出时，临时目录独立不会相互干扰。下载的文件权限以应用用户权限写入，FastAPI 进程有权删除即可。宝塔环境下一般运行FastAPI的用户需要对这些目录有读写删权限（通常没问题）。

与 UEditor 的集成方式说明

集成 UEditor 需要解决React框架与UEditor库之间的兼容。UEditor本质上是在页面上动态插入一个富文本编辑区域（通常基于iframe实现复杂编辑功能），通过全局 UE.getEditor() 来初始化。整合方案如下：
1.	UEditor资源引入：从 UEditor 官方获取前端资源包（或使用已经编译好的版本）。如果下载的是源码，需要先按照官方说明执行构建（如使用 grunt）得到发布文件 ￼。最终应得到一个包含 ueditor.all.js, ueditor.config.js, /lang/, /themes/ 等文件的目录 ￼。将此目录放入 React 工程的 public/ 目录并确保路径正确（例如放在 public/ueditor/）。这样，构建后这些文件将可通过 /ueditor/xxx.js URL 访问。
2.	页面加载顺序：编辑器初始化脚本应在 React 应用挂载前加载，否则React无法直接调用全局UE对象。最简单方式是在 public/index.html 模板中添加脚本引用：

<!-- public/index.html -->
...
<head>
  ...
  <script src="%PUBLIC_URL%/ueditor/ueditor.config.js"></script>
  <script src="%PUBLIC_URL%/ueditor/ueditor.all.js"></script>
  <script src="%PUBLIC_URL%/ueditor/lang/zh-cn/zh-cn.js"></script>
</head>
...

如此，页面打开时 UEditor 会挂载到 window.UE 对象 ￼。注意如果路径不对或文件未加载，初始化会失败。因此确保PUBLIC_URL正确指向根。另外，引入顺序：先 config 再 all.js，再语言包。

	3.	封装 React 组件：创建一个 React 组件如 <UEditorWidget> 来封装编辑器逻辑。组件内部包含一个容器元素，例如：

function UEditorWidget(props) {
const containerId = "ueditor-container";
useEffect(() => {
if (window.UE) {
const editor = window.UE.getEditor(containerId, { /* 配置项 */ });
if (props.onReady) {
editor.addListener('ready', () => props.onReady(editor));
}
// 可以监听内容改变或失焦等事件，将内容传给父组件或保存状态
editor.addListener('contentChange', () => {
const html = editor.getContent();
props.onChange && props.onChange(html);
});
}
return () => {
// 组件卸载时销毁UE实例
window.UE && window.UE.delEditor(containerId);
}
}, []);
return <script id={containerId} type="text/plain"></script>;  // UEditor 通过script标签初始化编辑区域
}

注意，这里的容器使用 <script type="text/plain"> 是UEditor要求的元素标签，用于替换为编辑区域。上述代码在组件加载时调用 UE.getEditor 实例化编辑器 ￼，并注册一些事件监听，比如内容变化时调用父组件传入的回调。也可以用 useImperativeHandle 暴露方法，例如 getContent() 方便父组件直接获取 ￼ ￼。

	4.	与React状态管理：典型用法是父组件维护一个状态如 content，将其传给 UEditorWidget 并通过 onChange 接收编辑器内容更新。或者简单地，在需要获取内容时再调用子组件的方法。由于UEditor自身在iframe中编辑，React无法直接控制内容，所以几乎只能通过UEditor API获取。
	5.	粘贴事件处理：针对本项目需求，可利用UEditor提供的粘贴处理接口。例如在 config 中可以设置 pasteplain 模式（粘贴为纯文本）以及 filterRules 自定义过滤规则。UEditor允许定义 UE.Editor.prototype.defaultOptions.filterRules 以对粘贴内容DOM进行修改；不过这些规则语法较复杂，也可以在 afterpaste 事件中自己处理。建议方案：
	•	打开 UEditor 的 autoHeightEnabled 以适应内容高度，但禁用粘贴时自动带格式（视情况，秀米内容如果有复杂排版，直接纯文本可能丢失太多，所以默认还是带格式粘贴，然后再我们自己的逻辑清洗）。
	•	监听 afterpaste：当触发时，调用我们前端清洗逻辑模块，对编辑器当前内容进行 inplace 清理。UEditor有 API editor.setContent(cleanedHtml) 可重设内容。这样用户粘贴后立刻看到的是清理后的版本。或者也可以不自动清理，而是提供“清理”按钮让用户点击触发，这样可以让用户对比粘贴前后效果。
	6.	工具栏与功能定制：UEditor默认工具栏很多，但本工具主要用来粘贴和简单编辑，因此可以配置最小化工具栏。例如仅保留粗体、斜体、列表、链接、图片等按钮，或甚至隐藏工具栏只留下编辑区域。通过 ueditor.config.js 或 getEditor 第二参数配置 toolbars: [...] 来定制。也可禁用UEditor自带的粘贴样式清理以避免冲突（比如 retainOnlyLabelPasted 等配置）。
	7.	获取内容并发送：在用户点击导出时，通过调用 UEditor 实例的 getContent() 拿到 HTML文本 ￼，然后交由我们的清洗模块处理（如果尚未处理）并发送给后端API。由于UEditor获取的内容通常包含<p>等标签包裹文本，应确保我们的清洗逻辑兼容这种结构（大部分情况下一致）。
	8.	UEditor后台接口：值得注意，UEditor通常配合后端接口实现图片上传、涂鸦等功能。但在本项目中，这些UEditor内置上传功能不需要启用，我们用不到UEditor的后端（例如它的Java/PHP文件）。因此可以在配置中关闭这些按钮或覆盖上传行为。如果未来需要，也可定制UEditor让其上传接口指向我们的FastAPI图片下载接口，但当前场景不需要用户主动上传图片文件。

综上，UEditor的集成关键是脚本引入和实例管理。通过上述方式，可在React中顺利使用UEditor提供富文本编辑能力，同时我们在React中掌控清洗和导出流程，不必修改UEditor源代码。整个集成实现成熟后，用户几乎感觉不到UEditor的存在，只看到一个熟悉的富文本编辑框，可以粘贴内容并操作。

宝塔环境部署说明

本项目需要在 宝塔面板 提供的服务器环境中部署，包括Python后端服务和前端静态文件托管。下面从后端部署、静态文件配置、以及反向代理几个方面说明：
•	后端Python服务部署：
1.	运行环境：确保服务器安装了 Python 3.13.2（或兼容3.11+版本）以及必要的依赖库。可以在宝塔的软件管理中安装对应Python版本，或使用宝塔提供的 Python 项目管理器。如果没有自动管理，可通过SSH手动安装Python环境和 pip。
2.	获取代码：将 backend 代码上传至服务器，例如放置在 /www/wwwroot/blog-ueditor/backend。安装依赖：进入该目录，执行 pip install -r requirements.txt，确保 FastAPI、httpx 等安装成功。
3.	启动应用：有多种方式：
•	开发模式：可直接用 uvicorn 启动，例如：
uvicorn app:app --host 0.0.0.0 --port 8000
这将在8000端口开启服务。开发测试可用 --reload 自动重载代码。
•	生产模式：推荐通过 Gunicorn + Uvicorn workers 或使用 uvicorn 加 supervisor 来守护运行。宝塔面板本身也有 PM2（针对 Node）或 Supervisor 插件可以用于守护Python进程。如果没有，也可以手动在 Linux 上配置 systemd 服务，或者使用 nohup/simple daemon 方式启动。关键是要保证服务在后台持续运行。
•	宝塔 Python项目管理：如果安装了对应插件，可以在面板中添加一个 Python项目，指定入口。例如模块app中的FastAPI实例app。宝塔会封装 Gunicorn 来运行它。这种方式简便，但也可以自行配置。
4.	测试后端：启动后，在服务器上使用 curl http://127.0.0.1:8000/docs 看FastAPI文档，或直接访问几个接口确保正常（如果有开放管理权限）。也可以暂不暴露端口，只通过反向代理。
•	前端静态文件托管：
1.	前端项目经过 npm run build 使用 Vite 打包，生成一套静态文件（HTML/CSS/JS）位于 frontend/dist 或配置的输出目录。
2.	将生成的所有文件上传/复制到后端的静态目录。例如放入 /www/wwwroot/blog-ueditor/backend/static/。其中应该包含 index.html、assets/等。如果使用前述架构，在 FastAPI 中已经 app.mount("/", StaticFiles(directory="static", html=True)) ￼，则无需额外Nginx配置即可通过后端服务提供前端页面。
3.	直接通过宝塔提供静态：可选方案是不通过FastAPI提供，而让 Nginx（宝塔面板核心）直接托管静态。即在宝塔中新增一个站点，根目录指向前端打包文件夹。但考虑到后端API也需同域名通信，一般配置为由后端serve或Nginx同时serve前端+反代后端。下面详述第二方案。
•	Nginx反向代理配置：
假设希望通过域名 yourdomain.com 来访问本应用。可以在宝塔中新建站点绑定该域名。
•	托管静态的方式1（FastAPI直接托管）：如果采用 FastAPI StaticFiles 托管前端，则只需将 Nginx 所有请求代理给uvicorn服务。例如，在宝塔面板-网站-设置-反向代理，目标URL填写 http://127.0.0.1:8000（假设uvicorn跑在8000）。并启用 WebSocket 支持（FastAPI docs使用时需要，虽然本项目不一定用到）。这样，Nginx会将yourdomain.com的请求都发给后端FastAPI，包括对/路径的请求（FastAPI会返回index.html)以及/api/...请求。此方案简单但静态内容也经过uvicorn，性能稍弱，不过前端文件不大且宝塔场景一般访问量不高，可以接受。
•	托管静态的方式2（Nginx+FastAPI分离）：让Nginx直接提供前端文件，同时把API请求转发后端。这需要：将前端打包文件放在站点根目录（或子目录）供Nginx读取；配置 Nginx 区分 API 路径。例如约定所有后端接口路径以 /api/ 开头。则 Nginx 配置类似：

location /api/ {
proxy_pass http://127.0.0.1:8000/;   # 转发给后端FastAPI
proxy_set_header Host $host;
...
}
location / {
try_files $uri $uri/ /index.html;   # 前端SPA配置，未找到文件则返回index.html
root /www/wwwroot/blog-ueditor/frontend/dist;  # 静态文件路径
}

这样 /api/* 的请求交给FastAPI，其余路径由Nginx直接返回前端文件。如果采用这个方案，需要在前端构建时配置 API 请求的基础URL为 /api 对应（例如 axios 的 baseURL 等）。
宝塔面板中可以直接在网站的“配置文件”编辑上述内容，保存后重载 Nginx 生效。

	•	域名和端口：确保宝塔安全组和防火墙放行80/443端口。如果使用HTTPS，也可以在宝塔中申请并配置 SSL。如果只是测试，也可直接用IP加端口访问 uvicorn（不经过Nginx），但正式部署推荐通过Nginx转发，便于日后扩展和安全控制。

	•	宝塔环境注意事项：
	•	后台运行：如果不用宝塔的Python项目管理，直接命令行运行uvicorn，需要保证关闭SSH后仍然运行。可使用 nohup uvicorn ... & 或配置 systemd。在面板里，可以利用“计划任务”在系统重启后运行启动脚本，确保服务持久。
	•	日志与监控：宝塔面板提供访问日志界面，但那主要针对Nginx。如果需要查看FastAPI内部日志，可以将 uvicorn 日志输出到文件，在面板上查看，或者进入容器/终端看实时日志。
	•	依赖管理：Python依赖尽量使用虚拟环境隔离。如果宝塔Python管理支持，在面板里创建项目时可以创建 venv。这便于升级Python或装其他项目不冲突。
	•	性能调优：根据需求，可调整 uvicorn 的 workers 数量 (Gunicorn + Uvicorn)，对多并发有好处。也可以利用宝塔的 Supervisor 插件托管，让它自动拉起挂掉的进程。
	•	静态文件缓存：Nginx 默认会对静态资源启用缓存头，确保前端加载性能。但因为这是离线工具，不是高频访问的网站，所以不用特别优化。如果需要，可以调Nginx的静态文件header如 expires。

总之，在宝塔环境下，推荐通过 Nginx 反代FastAPI模式：配置简单且充分发挥Nginx处理静态的效率 ￼。在调通后端服务后，只需在宝塔网站设置里添加反向代理规则即可上线使用。Python后端和React前端都部署在同一主机同一域名下，方便客户端调用，不涉及跨域问题（或可直接允许同域跨域）。这样整个部署完成后，用户访问域名即可使用blog-ueditor工具，所有离线处理功能均在服务器完成。

开发任务拆解

为了高效推进开发，可将本项目拆解为以下任务卡片，团队并行或流水式完成：
1.	项目初始化：
•	设置前端项目结构（React + Vite + TS），配置基础依赖（React, Axios/Fetch, etc）。
•	设置后端项目结构（FastAPI 初始化，创建 app.py 等），配置依赖（FastAPI, httpx 等）。
2.	UEditor 集成：
•	下载并构建 UEditor 前端资源，在前端公共目录加入 UEditor文件。
•	开发 React 富文本组件封装UEditor实例，实现挂载和销毁，以及提供内容获取接口。
•	测试UEditor在React中的基本使用，确保可以正常输入和获取HTML。
3.	前端清洗逻辑 (Safe/Aggressive)：
•	编写 HTML 清洗函数（或模块），基于规则移除不需要的标签和属性。可先实现Aggressive（完全去样式）模式，再实现Safe模式的保留部分规则。
•	配置触发方式：实现一个“清理内容”按钮，点击后对当前编辑器内容执行清洗，更新编辑器内容或展示清洗结果在预览面板。
•	编写单元测试或使用典型秀米HTML样本来验证清洗效果，不同模式下元素保留情况。
4.	图片提取与前端标记：
•	实现函数提取编辑内容中的所有图片URL（包括和background-image）。可在清洗后或之前执行，确保拿到完整URL列表。
•	处理去重、过滤无效URL（如空src）。
•	将提取逻辑集成到导出流程，在用户点击导出时获取列表。
5.	后端API设计：
•	定义 FastAPI 路由和Pydantic模型：如 DownloadImagesRequest, ExportRequest 和对应 Response 模型（包含images下载结果、或返回FileResponse）。
•	实现图片下载函数（使用 httpx.AsyncClient）。先调通单个URL下载，再扩展为批量并发下载，处理异常和超时。
•	实现 export 接口主要逻辑（组织调用下载、替换HTML、写文件、压缩）。暂时可以不实际压缩，先写文件验证输出正确。
6.	后端文件生成与压缩：
•	完善导出流程：创建临时目录，写 index.html、images/* 和 manifest.json 文件。
•	使用 zipfile 将目录压缩，返回 FileResponse 测试前端能否下载。
•	加入 BackgroundTask 实现文件自动清理。测试异常情况下不会遗留临时文件。
7.	前后端接口对接：
•	在前端导出按钮点击时，用 Fetch/Axios 调用后端 /export 接口，发送清洗后HTML和图片列表。
•	处理接口响应：成功时触发浏览器下载（前端可以创建一个隐藏链接指向返回的文件URL并点击）。需要考虑FastAPI返回FileResponse的处理，可能直接就是一个文件下载，无需Axios处理blob。如果配置了 response_class=FileResponse，前端调用可以通过浏览器默认下载行为（也可以改用标签href方式）。根据实现调整：可能后端返回JSON包含zip临时路径，前端再去download；或直接返回zip流。倾向于直接返回zip流并content-disposition触发下载，这样前端只需打开一个URL下载即可。
•	错误处理：如果后端返回错误消息，前端提示用户。
8.	前端预览模块:
•	实现预览组件，可以在对话框或新窗口中显示清洗后的HTML。确保引用的图片路径正确（可能需要先调用下载API获取部分图片，或直接使用原URL也行，因为预览时还没离线）。其实预览可直接使用编辑器内容区域作为所见即所得。如果需要Aggressive模式预览，可能要将Aggressive清洗结果展示给用户看再确认。实现一个切换，例如选中Aggressive时重新清洗内容并显示预览。
•	预览模块并非必须独立页面，也可以在编辑器下方/侧方提供所见即所得对比，按时间和重要性自行决定深度。
9.	模式切换与UI完善:
•	在界面上提供 Safe/Aggressive 模式的切换控件（如下拉或开关）。当切换时如果内容已存在可即时重新清洗预览，或者仅标记模式在导出时生效。
•	美化界面：添加必要的说明文本（比如提示用户粘贴秀米内容）、导出按钮样式、进度提示等。可使用简单的组件库或CSS样式。
10.	功能测试与质量保证:
•	使用多种秀米导出的内容片段进行测试，包括：带有多张图片、大量样式、SVG元素等的HTML。验证 Safe 模式下布局大致保留，Aggressive下文字都在、无样式。
•	测试图片下载：针对一些图片URL，包含http/https，异常情况（404图片）。检查manifest记录是否正确。
•	在本地模拟打开导出的zip，看 index.html 加载所有本地图片是否OK，manifest信息正确。
•	前端不同浏览器的适配测试（主要JavaScript，UEditor兼容IE吗？现代浏览器都行即可）。
•	性能测试：大量图片时（比如50张），导出用时是否可接受，前端有没有卡顿。必要时优化，如对于非常大的HTML可以考虑后台也做clean等。
11.	部署与上线:
•	在宝塔环境部署应用，按照前述指南配置。
•	域名和证书设置，如果有的话。
•	线上测试一遍流程，特别注意文件权限和路径问题（例如 Linux 大小写敏感导致路径错误）。
•	编写部署脚本或说明，方便以后更新前后端代码。
12.	文档编写:
•	完善 README 或用户手册，说明使用方法（例如用户如何复制秀米内容、选择模式、一键导出）。
•	写开发文档说明架构和代码结构（部分即是本方案整理的内容）。
•	后端接口文档（见下节）提供给团队或未来维护者参考。

每个任务可细分为多个子任务，团队成员认领后交叉检查。任务顺序上，UEditor集成和前端清洗逻辑可以并行于后端接口开发，最终在对接时结合。通过上述拆解，开发过程清晰明确，也降低各部分耦合风险。

接口文档

后端采用 RESTful API 设计，所有接口路径以 /api/v1 为前缀，支持版本化管理。

---

## 核心接口（必须实现）

### 1. POST /api/v1/exports – 创建导出任务

创建一个新的导出任务（资源）。由于图片下载和打包可能耗时较长，采用异步处理模式。

**请求格式：** Content-Type: application/json

```json
{
  "html": "<section>...清洗后的HTML内容...</section>",
  "mode": "safe",
  "options": {
    "download_images": true,
    "rewrite_failed_images": "keep_remote"
  }
}
```

**字段说明：**
- `html` (string, 必须)：清洗处理后的 HTML 内容字符串
- `mode` (string, 可选)：清洗模式，`"safe"` 或 `"aggressive"`，默认 `"safe"`
- `options` (object, 可选)：导出选项
  - `download_images` (boolean)：是否下载图片，默认 `true`
  - `rewrite_failed_images` (string)：失败图片处理策略
    - `"keep_remote"`：保留原始外链（默认）
    - `"remove"`：移除失败的图片引用

**响应：** HTTP 202 Accepted（异步处理）

```http
HTTP/1.1 202 Accepted
Location: /api/v1/exports/exp_8f2c4a1b
Content-Type: application/json

{
  "id": "exp_8f2c4a1b",
  "status": "processing",
  "created_at": "2026-01-04T21:30:00Z",
  "expires_at": "2026-01-04T22:30:00Z",
  "links": {
    "self": "/api/v1/exports/exp_8f2c4a1b",
    "archive": "/api/v1/exports/exp_8f2c4a1b/archive",
    "manifest": "/api/v1/exports/exp_8f2c4a1b/manifest"
  }
}
```

---

### 2. GET /api/v1/exports/{exportId} – 查询导出任务状态

查询指定导出任务的当前状态和进度信息。

**路径参数：**
- `exportId` (string)：导出任务ID

**响应：** HTTP 200 OK

```json
{
  "id": "exp_8f2c4a1b",
  "status": "processing",
  "progress": {
    "done": 3,
    "total": 12
  },
  "stats": {
    "images_found": 12,
    "images_downloaded": 3,
    "images_failed": 1
  },
  "created_at": "2026-01-04T21:30:00Z",
  "expires_at": "2026-01-04T22:30:00Z",
  "links": {
    "self": "/api/v1/exports/exp_8f2c4a1b",
    "archive": "/api/v1/exports/exp_8f2c4a1b/archive",
    "manifest": "/api/v1/exports/exp_8f2c4a1b/manifest"
  }
}
```

**状态枚举 (status)：**
- `queued`：任务已创建，等待处理
- `processing`：正在处理中（下载图片/打包）
- `completed`：处理完成，可下载
- `failed`：处理失败
- `expired`：任务已过期，资源已清理

---

### 3. GET /api/v1/exports/{exportId}/archive – 下载离线包

下载已完成的导出任务的 ZIP 压缩包。

**路径参数：**
- `exportId` (string)：导出任务ID

**响应：**
- 成功：HTTP 200 OK，Content-Type: application/zip
- 未完成：HTTP 409 Conflict（任务仍在处理中）
- 不存在：HTTP 404 Not Found
- 已过期：HTTP 410 Gone

```http
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="blog-ueditor-exp_8f2c4a1b.zip"

[ZIP 文件二进制内容]
```

---

### 4. GET /api/v1/exports/{exportId}/manifest – 获取资源清单

获取导出任务的 manifest.json 内容，包含图片下载状态等详细信息。

**路径参数：**
- `exportId` (string)：导出任务ID

**响应：** HTTP 200 OK，Content-Type: application/json

```json
{
  "export_id": "exp_8f2c4a1b",
  "mode": "safe",
  "created_at": "2026-01-04T21:30:00Z",
  "images": [
    {
      "url": "https://example.com/image1.png",
      "filename": "images/1.png",
      "status": "downloaded",
      "size": 102400
    },
    {
      "url": "https://example.com/bg.jpg",
      "filename": null,
      "status": "failed",
      "error": "HTTP 403 Forbidden"
    }
  ],
  "stats": {
    "total": 12,
    "downloaded": 11,
    "failed": 1,
    "total_size": 1548288
  }
}
```

---

## 可选接口

### 5. DELETE /api/v1/exports/{exportId} – 取消/清理导出任务

取消正在处理的任务，或删除已完成的任务以释放服务器空间。

**路径参数：**
- `exportId` (string)：导出任务ID

**响应：** HTTP 204 No Content

**行为说明：**
- 任务处于 `processing` 状态：取消任务并清理临时文件
- 任务处于 `completed` 状态：删除缓存的 ZIP 文件
- 任务不存在：返回 HTTP 404 Not Found

> ⚠️ **重要：** 在宝塔环境下强烈建议实现此接口，否则临时目录可能累积大量文件。

---

### 6. GET /api/v1/exports/{exportId}/document – 获取清洗后的 HTML（可选）

获取清洗并替换图片路径后的最终 HTML 内容。

**响应：** HTTP 200 OK，Content-Type: text/html

---

### 7. GET /api/v1/health – 健康检查

返回服务运行状态，用于监控和负载均衡。

**响应：** HTTP 200 OK

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}
```

---

## 统一错误响应格式

采用 RFC 7807 Problem Details 标准格式（Content-Type: application/problem+json）：

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://blog-ueditor.example.com/problems/invalid-html",
  "title": "Invalid HTML payload",
  "status": 422,
  "detail": "Field `html` must be a non-empty string",
  "instance": "/api/v1/exports"
}
```

**常见错误码：**
- `400 Bad Request`：请求格式错误
- `404 Not Found`：资源不存在
- `409 Conflict`：资源状态冲突（如尝试下载未完成的任务）
- `410 Gone`：资源已过期或被删除
- `422 Unprocessable Entity`：请求语义错误（如 HTML 为空）
- `429 Too Many Requests`：请求频率超限
- `500 Internal Server Error`：服务器内部错误

---

## REST 设计细节与约束

### API 版本化
所有接口使用 `/api/v1/` 前缀，便于未来版本升级而不破坏现有客户端。

### 幂等性（推荐实现）
对 `POST /api/v1/exports` 支持 `Idempotency-Key` 请求头，避免用户重复点击导致创建多个相同任务：

```http
POST /api/v1/exports
Idempotency-Key: user-session-abc123-timestamp
Content-Type: application/json

{ ... }
```

相同 `Idempotency-Key` 的重复请求将返回已创建任务的信息，而非创建新任务。

### 缓存与过期
- 导出结果设置 `expires_at`，默认 1 小时后过期
- 过期后资源自动清理，访问返回 `410 Gone`
- 前端应在任务完成后尽快下载

### 限流与大小限制
- HTML 内容最大：2MB
- 单次导出图片数量上限：200 张
- 单用户并发任务上限：5 个
- 请求频率限制：60 次/分钟

> 这些限制可防止服务被当作图片下载器滥用。

### CORS 配置
- 同域部署（推荐）：无需特殊配置
- 跨域部署：后端需配置 `Access-Control-Allow-Origin` 等响应头

---

## 接口调用流程示例

```
1. 前端发起导出请求
   POST /api/v1/exports → 202 Accepted, 获取 exportId

2. 前端轮询任务状态（或使用 WebSocket）
   GET /api/v1/exports/{exportId} → 200 OK, status: "processing"
   ...
   GET /api/v1/exports/{exportId} → 200 OK, status: "completed"

3. 前端下载 ZIP 文件
   GET /api/v1/exports/{exportId}/archive → 200 OK, 触发下载

4. （可选）查看详细结果
   GET /api/v1/exports/{exportId}/manifest → 200 OK, 获取图片下载详情

5. （可选）清理资源
   DELETE /api/v1/exports/{exportId} → 204 No Content
```

---

## 接口安全

本工具主要自用，基础版本未设鉴权。如需上线公共服务，建议：
- 在宝塔 Nginx 层添加访问密码或 IP 白名单
- 实现简单的 API Key 认证
- 配置上述限流规则防止滥用

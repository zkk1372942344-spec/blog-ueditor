# Repository Guidelines

## 通用规则
- 函数名用驼峰命名法
- 所有对话回复统一使用中文
- 所有的代码的请写好详细的注释
- Admin.md 文件是当前项目的开发文档和开发任务书

## 项目结构与模块组织
- `frontend/`：React + TypeScript + Vite 的单页应用。
  - `frontend/src/`：UI 组件与前端逻辑。
  - `frontend/public/`：静态资源；UEditor 文件放在 `frontend/public/ueditor/`。
  - `frontend/dist/`：生产构建产物（自动生成）。
- `backend/`：FastAPI 服务，负责图片下载与离线包导出。
  - `backend/app.py`：主要 API 实现与导出流程。
  - `backend/requirements.txt`：Python 依赖。
  - `backend/static/`：前端构建产物（生产环境托管）。
  - `backend/export_temp/`：导出任务运行时创建的临时目录。

## 构建、测试与开发命令
前端（在 `frontend/` 下执行）：
- `npm install`：安装依赖。
- `npm run dev`：启动 Vite 开发服务器。
- `npm run build`：类型检查并打包生产产物。
- `npm run lint`：运行 ESLint。
- `npm run preview`：本地预览生产构建。

后端（在 `backend/` 下执行）：
- `pip install -r requirements.txt`：安装后端依赖。
- `uvicorn app:app --host 0.0.0.0 --port 8000 --reload`：开发模式启动 API。

## 编码风格与命名规范
- 前端使用 2 空格缩进、无分号；组件名使用 PascalCase（参见 `frontend/src/App.tsx`）。
- 后端遵循 PEP 8，4 空格缩进；函数使用 snake_case（参见 `backend/app.py`）。
- TypeScript 中在语义不明确时显式标注类型；API 数据结构统一用 Pydantic 模型。
- 前端改动提交前建议运行 `npm run lint`。

## 测试规范
- 当前尚未配置项目级测试套件。
- 若新增测试，请在 `frontend/package.json` 或后端中补充对应的测试命令与说明。

## 提交与合并请求规范
- 当前目录下未检测到 Git 仓库，无法参考历史提交格式。
- 提交信息建议使用祈使句，例如："Add export manifest fields"。
- PR 应包含：简要说明、验证步骤，涉及 UI 变更需提供截图。

## 部署与打包说明
- 生产部署需将 `frontend/dist/` 复制到 `backend/static/` 后再启动 FastAPI。
- 导出的 ZIP 内包含 `index.html`、`manifest.json` 与 `images/`，临时文件位于 `backend/export_temp/`。

## Codex 审查规则
- Codex 审查优先关注：功能回归、异常处理、数据安全、导出流程稳定性与性能风险。
- 对前端代码重点检查：清洗规则副作用、异步状态一致性、大内容渲染性能与错误提示完整性。
- 对后端代码重点检查：任务状态一致性、并发下载与重试逻辑、临时文件清理与过期任务回收。
- 审查输出优先给出可执行修改建议，并标注影响范围与建议验证步骤。
- 在 PR 评论中提及 `@codex` 可手动触发任务或请求补充审查。

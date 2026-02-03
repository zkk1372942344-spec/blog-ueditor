# Codex 代码审查接入说明

本文档用于启用并验证本仓库的 Codex PR 审查能力。

## 1. 在 GitHub 启用 Codex 自动审查

1. 进入 ChatGPT（Codex）中的 **代码** 页面并连接 GitHub 账号。
2. 选择仓库 `zkk1372942344-spec/blog-ueditor`。
3. 打开仓库设置中的 **Code review**（自动审查）开关。
4. 确认 Codex 对该仓库拥有读取代码与评论 PR 的权限。

> 说明：自动审查开关在 GitHub/ChatGPT 平台侧，不能仅通过仓库代码文件开启。

## 2. 仓库内已配置内容

- `AGENTS.md`：定义了本项目的审查重点与规则。
- `.github/pull_request_template.md`：提供 `@codex` 手动触发审查提示。

## 3. 触发方式

- 自动触发：创建或更新 PR 后，Codex 自动给出审查建议或 `👍`。
- 手动触发：在 PR 评论中输入：

```text
@codex 请帮我审查这个 PR
```

## 4. 验证清单

1. 创建测试 PR（包含前后端改动各 1 处）。
2. 观察 PR 时间线中是否出现 Codex 评论。
3. 在评论里提及 `@codex`，确认可再次触发审查。
4. 根据建议修改后再次推送，确认 Codex 能识别增量变更。

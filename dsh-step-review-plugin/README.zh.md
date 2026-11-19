# dsh-step-review-plugin

[English](README.md) | 中文

按照 DeepSeek Harness 官方规范开发的 npm 组合包插件（bundle）：在智能体每步（Step）执行完毕后自动暂停，通过 `ctx.userQuestions` 弹出预设的评价选项框，待用户点击选项后按所选动作（直接继续、注入评价反馈后继续、或终止本轮执行）恢复运行。

## 安装与启用

### 通过 npm 订阅安装（常规方式）

插件发布至 npm 后，通过 `dsh plugin` 安装到指定的 profile（例如 `web`）：

```sh
dsh plugin --profile web add dsh-step-review-plugin
```

也可通过 `--dump-config` 预览组合后的配置：

```sh
dsh --profile web --dump-config
```

### 本地打包直装（仅限开发测试）

仅在本地开发、联调或发版前测试阶段使用：

```sh
pnpm --filter dsh-step-review-plugin run build
pnpm --filter dsh-step-review-plugin pack
dsh plugin --profile web add ./dsh-step-review-plugin/dsh-step-review-plugin-0.1.0.tgz
```

## 工作机制

1. **步骤完成记录（`session/event` -> `step/end`）**：监听持久化会话事件 `step/end`，记录当前轮次（`turn`）与刚完成的步骤号（`step`），并确保同一步骤绝不重复弹窗。
2. **多步循环间拦截（`agent/pre-step` waterfall）**：当某一步触发工具调用并准备进入同轮下一步（`step > 1`）时，在 `agent/pre-step` 瀑布流中调用 `ctx.userQuestions.ask()` 挂起等待用户评价。
3. **单步/末步收尾拦截（`agent/turn-stopping` serial）**：当某一步无后续工具调用、轮次即将结束时，在 `agent/turn-stopping` 串行检查点挂起等待用户评价；若用户选择反馈改进，则通过 `agent.steer()` 将评价注入下一步并继续本轮循环。
4. **评价动作映射**：
   - `continue`：直接恢复执行，不额外向模型上下文注入消息（若用户同时填写了自定义补充说明，则作为反馈一并传入）。
   - `feedback`：将预设的 `feedbackText`（支持 `{turn}`、`{step}` 占位符）及用户可选的自定义输入封装为 `source.kind = 'step-review'` 的 `UserMessage`，送入下一步模型请求。
   - `stop`：在 `agent/pre-step` 中返回 `{ kind: 'reject' }` 阻断后续步骤，或在 `agent/turn-stopping` 中直接结束当前轮次。

## 配置说明（`cordis.patch.yml`）

所有可调参数均通过 Schemastery `Config` schema 声明并支持在 `cordis.patch.yml` 中覆盖，加载时自动执行严格校验：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `questionId` | `string` | `'step-review'` | `userQuestions` 问答项的稳定标识 |
| `header` | `string` | `'步骤评价'` | 评价弹窗顶部短标题（支持 `{turn}`、`{step}`） |
| `question` | `string` | `'智能体已完成第 {turn} 轮第 {step} 步，请评价本步执行结果：'` | 评价弹窗主问题文案（支持 `{turn}`、`{step}`） |
| `detail` | `string` | `'请选择下方预设评价选项以恢复执行…'` | 评价弹窗辅助说明文案（支持 `{turn}`、`{step}`） |
| `feedbackPrefix` | `string` | `'【用户步骤评价】'` | 注入模型上下文时的反馈前缀 |
| `onUnavailable` | `'continue' \| 'stop'` | `'continue'` | 无交互式问答端（`NO_PROVIDER`）时的回退策略 |
| `onDismiss` | `'stop' \| 'continue'` | `'stop'` | 用户关闭弹窗（`ASK_CANCELLED`）时的回退策略 |
| `options` | `StepReviewOptionConfig[]` | 4 个预设评价项 | 预设评价选项列表（`label`、`description`、`action`、`feedbackText`） |

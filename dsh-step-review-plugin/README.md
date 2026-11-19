# dsh-step-review-plugin

English | [中文](README.zh.md)

A DeepSeek Harness bundle plugin published via npm that pauses execution after each completed agent step, pops up a predefined evaluation option card through `ctx.userQuestions`, and resumes, steers with feedback, or stops execution after the user selects an option.

## Installation

### From npm (standard)

Install the published bundle from npm into your `dsh` profile:

```sh
dsh plugin --profile web add dsh-step-review-plugin
```

Or preview the composed configuration without launching:

```sh
dsh --profile web --dump-config
```

### Local tarball installation (development & testing only)

For local development and pre-publish testing only:

```sh
pnpm --filter dsh-step-review-plugin run build
pnpm --filter dsh-step-review-plugin pack
dsh plugin --profile web add ./dsh-step-review-plugin/dsh-step-review-plugin-0.1.0.tgz
```

## Configuration

Override the `step-review` row in your profile's `cordis.patch.yml`:

```yaml
- id: step-review
  name: dsh-step-review-plugin
  config:
    header: '步骤评价'
    question: '智能体已完成第 {turn} 轮第 {step} 步，请评价本步执行结果：'
    detail: '请选择下方预设评价选项以恢复执行，或在自定义输入框中填写具体指导意见。'
    feedbackPrefix: '【用户步骤评价】'
    onUnavailable: 'continue'
    onDismiss: 'stop'
    options:
      - label: '满意，继续执行'
        description: '当前步骤表现符合预期，直接恢复下一步执行。'
        action: 'continue'
      - label: '需微调后继续'
        description: '当前步骤基本可用但存在细节问题，要求智能体在下一步修正。'
        action: 'feedback'
        feedbackText: '用户对第 {turn} 轮第 {step} 步的评价为「需微调后继续」：请复核上一步的输出与工具调用结果，修正细节问题后再继续推进。'
      - label: '不满意，重新规划'
        description: '当前步骤方向偏离，要求智能体停止当前做法并重新调整方案。'
        action: 'feedback'
        feedbackText: '用户对第 {turn} 轮第 {step} 步的评价为「不满意，重新规划」：请暂停当前实现路径，重新审视任务要求并给出修正方案。'
      - label: '终止本轮执行'
        description: '立即暂停并结束当前轮次，交还输入控制权。'
        action: 'stop'
```

/**
 * Cordis plugin that pauses execution after each completed agent step, presents
 * predefined evaluation options via `ctx.userQuestions`, and resumes, steers,
 * or stops the turn based on the user's choice.
 *
 * @module dsh-step-review-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { UserQuestionError, type AskUserQuestionAnswer, type AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import z from '@deepseek-ai/schemastery'
import type {
  DismissPolicy,
  ResolvedStepReviewConfig,
  ResolvedStepReviewOption,
  StepPosition,
  StepReviewAction,
  StepReviewOptionConfig,
  StepReviewOutcome,
  UnavailablePolicy,
} from './types.ts'

export type {
  DismissPolicy,
  ResolvedStepReviewConfig,
  ResolvedStepReviewOption,
  StepPosition,
  StepReviewAction,
  StepReviewOptionConfig,
  StepReviewOutcome,
  UnavailablePolicy,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'step-review'

/** Required Host services: live agent registry and user-questions capability seam. */
export const inject = ['agents', 'userQuestions']

/** Raw plugin configuration accepted from `cordis.yml`. */
export interface Config {
  /** Stable question id echoed in `dsh-user-questions` answers. */
  questionId?: string
  /** Short heading displayed on the evaluation card; supports `{turn}` and `{step}`. */
  header?: string
  /** Question text displayed to the user; supports `{turn}` and `{step}`. */
  question?: string
  /** Optional detail text displayed on the evaluation card; supports `{turn}` and `{step}`. */
  detail?: string
  /** Prefix prepended to model-facing evaluation feedback messages. */
  feedbackPrefix?: string
  /** Policy when no `userQuestions` answerer is available (`NO_PROVIDER`). */
  onUnavailable?: UnavailablePolicy
  /** Policy when the user dismisses the evaluation card (`ASK_CANCELLED`) or skips all options. */
  onDismiss?: DismissPolicy
  /** Predefined evaluation options shown after each step finishes. */
  options?: StepReviewOptionConfig[]
}

const DEFAULT_OPTIONS: StepReviewOptionConfig[] = [
  {
    label: '满意，继续执行',
    description: '当前步骤表现符合预期，直接恢复下一步执行。',
    action: 'continue',
  },
  {
    label: '需微调后继续',
    description: '当前步骤基本可用但存在细节问题，要求智能体在下一步修正。',
    action: 'feedback',
    feedbackText: '用户对第 {turn} 轮第 {step} 步的评价为「需微调后继续」：请复核上一步的输出与工具调用结果，修正细节问题后再继续推进。',
  },
  {
    label: '不满意，重新规划',
    description: '当前步骤方向偏离，要求智能体停止当前做法并重新调整方案。',
    action: 'feedback',
    feedbackText: '用户对第 {turn} 轮第 {step} 步的评价为「不满意，重新规划」：请暂停当前实现路径，重新审视任务要求并给出修正方案。',
  },
  {
    label: '终止本轮执行',
    description: '立即暂停并结束当前轮次，交还输入控制权。',
    action: 'stop',
  },
]

const stepReviewOptionSchema = z.object({
  label: z.string().required(),
  description: z.string(),
  action: z.union(['continue', 'feedback', 'stop']).default('continue'),
  feedbackText: z.string(),
})

/** Schemastery configuration schema validated by the Cordis loader. */
export const Config: z<Config> = z.object({
  questionId: z.string().default('step-review'),
  header: z.string().default('步骤评价'),
  question: z.string().default('智能体已完成第 {turn} 轮第 {step} 步，请评价本步执行结果：'),
  detail: z.string().default('请选择下方预设评价选项以恢复执行，或在自定义输入框中填写具体指导意见。'),
  feedbackPrefix: z.string().default('【用户步骤评价】'),
  onUnavailable: z.union(['continue', 'stop']).default('continue'),
  onDismiss: z.union(['stop', 'continue']).default('stop'),
  options: z.array(stepReviewOptionSchema).default(DEFAULT_OPTIONS),
})

function requireNonEmptyString(field: string, value: string | undefined, fallback: string): string {
  const resolved = (value ?? fallback).trim()
  if (resolved === '') {
    throw new Error(`step-review: \`${field}\` must be a non-empty string`)
  }
  return resolved
}

function isStepReviewAction(value: string): value is StepReviewAction {
  return value === 'continue' || value === 'feedback' || value === 'stop'
}

function isUnavailablePolicy(value: string): value is UnavailablePolicy {
  return value === 'continue' || value === 'stop'
}

function isDismissPolicy(value: string): value is DismissPolicy {
  return value === 'stop' || value === 'continue'
}

/**
 * Validate and normalize plugin configuration at load time.
 * Self-contained misconfigurations fail loud during plugin initialization.
 *
 * @param config - Raw configuration supplied by the loader or caller.
 * @returns Detached, validated specification with all defaults resolved.
 */
export function resolveConfig(config: Config = {}): ResolvedStepReviewConfig {
  const questionId = requireNonEmptyString('questionId', config.questionId, 'step-review')
  const header = requireNonEmptyString('header', config.header, '步骤评价')
  const question = requireNonEmptyString(
    'question',
    config.question,
    '智能体已完成第 {turn} 轮第 {step} 步，请评价本步执行结果：',
  )
  const feedbackPrefix = requireNonEmptyString('feedbackPrefix', config.feedbackPrefix, '【用户步骤评价】')

  let detail: string | undefined
  if (config.detail !== undefined) {
    const trimmedDetail = config.detail.trim()
    if (trimmedDetail === '') {
      throw new Error('step-review: `detail` must not be blank when provided')
    }
    detail = trimmedDetail
  }

  const onUnavailable = config.onUnavailable ?? 'continue'
  if (!isUnavailablePolicy(onUnavailable)) {
    throw new Error(`step-review: invalid \`onUnavailable\` policy "${String(onUnavailable)}"`)
  }

  const onDismiss = config.onDismiss ?? 'stop'
  if (!isDismissPolicy(onDismiss)) {
    throw new Error(`step-review: invalid \`onDismiss\` policy "${String(onDismiss)}"`)
  }

  const rawOptions = config.options ?? DEFAULT_OPTIONS
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    throw new Error('step-review: `options` must contain at least one evaluation option')
  }

  const seenLabels = new Set<string>()
  const options: ResolvedStepReviewOption[] = rawOptions.map((item, index) => {
    const label = item.label.trim()
    if (label === '') {
      throw new Error(`step-review: \`options[${index}].label\` must be a non-empty string`)
    }
    if (seenLabels.has(label)) {
      throw new Error(`step-review: duplicate option label "${label}" in \`options\``)
    }
    seenLabels.add(label)

    if (!isStepReviewAction(item.action)) {
      throw new Error(`step-review: invalid \`options[${index}].action\` "${String(item.action)}"`)
    }

    let description: string | undefined
    if (item.description !== undefined) {
      const trimmedDesc = item.description.trim()
      if (trimmedDesc === '') {
        throw new Error(`step-review: \`options[${index}].description\` must not be blank when provided`)
      }
      description = trimmedDesc
    }

    let feedbackText: string | undefined
    if (item.feedbackText !== undefined) {
      const trimmedFeedback = item.feedbackText.trim()
      if (trimmedFeedback === '') {
        throw new Error(`step-review: \`options[${index}].feedbackText\` must not be blank when provided`)
      }
      feedbackText = trimmedFeedback
    }

    return {
      label,
      ...(description === undefined ? {} : { description }),
      action: item.action,
      ...(feedbackText === undefined ? {} : { feedbackText }),
    }
  })

  return {
    questionId,
    header,
    question,
    ...(detail === undefined ? {} : { detail }),
    feedbackPrefix,
    onUnavailable,
    onDismiss,
    options,
  }
}

/**
 * Interpolate `{turn}` and `{step}` placeholders in a configured template string.
 *
 * @param template - Template containing optional `{turn}` and `{step}` tokens.
 * @param position - Completed step coordinates.
 * @returns Interpolated display or feedback string.
 */
export function formatStepTemplate(template: string, position: StepPosition): string {
  return template
    .replaceAll('{turn}', String(position.turn))
    .replaceAll('{step}', String(position.step))
}

function buildFeedbackMessage(
  spec: ResolvedStepReviewConfig,
  position: StepPosition,
  body: string,
  summaryLabel: string,
): UserMessage {
  const text = `${spec.feedbackPrefix} ${body}`
  const summary = `${spec.feedbackPrefix} 第 ${position.turn} 轮第 ${position.step} 步：${summaryLabel}`
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'step-review',
      form: 'notice',
      summary,
    },
  })
}

function interpretAnswer(
  spec: ResolvedStepReviewConfig,
  position: StepPosition,
  answer: AskUserQuestionAnswer,
): StepReviewOutcome {
  const item = answer.answers.find(entry => entry.id === spec.questionId) ?? answer.answers[0]
  const customText = item?.custom?.trim() ?? ''
  const selectedLabel = item?.selected[0]

  if (selectedLabel === undefined && customText === '') {
    return spec.onDismiss === 'stop' ? { kind: 'stop' } : { kind: 'continue' }
  }

  const matchedOption = selectedLabel === undefined
    ? undefined
    : spec.options.find(option => option.label === selectedLabel)

  if (matchedOption === undefined) {
    const fallbackBody = customText !== '' ? customText : (selectedLabel ?? '')
    return {
      kind: 'feedback',
      message: buildFeedbackMessage(spec, position, fallbackBody, fallbackBody),
    }
  }

  switch (matchedOption.action) {
    case 'stop':
      return { kind: 'stop' }
    case 'continue':
      if (customText !== '') {
        return {
          kind: 'feedback',
          message: buildFeedbackMessage(
            spec,
            position,
            `${matchedOption.label}（补充说明：${customText}）`,
            matchedOption.label,
          ),
        }
      }
      return { kind: 'continue' }
    case 'feedback': {
      const baseText = formatStepTemplate(matchedOption.feedbackText ?? matchedOption.label, position)
      const combined = customText === '' ? baseText : `${baseText}\n用户补充说明：${customText}`
      return {
        kind: 'feedback',
        message: buildFeedbackMessage(spec, position, combined, matchedOption.label),
      }
    }
  }
}

/**
 * Pause the agent after a completed step, present the configured evaluation options
 * via `ctx.userQuestions.ask`, and map the user's response to a {@link StepReviewOutcome}.
 *
 * Delegated subagents (`origin === 'subagent'`) and non-live agents bypass interactive
 * prompting because `dsh-user-questions` restricts human interaction to live root agents.
 *
 * @param ctx - Active Cordis context providing `agents` and `userQuestions`.
 * @param spec - Validated step-review configuration.
 * @param agent - Agent whose completed step is being reviewed.
 * @param position - Turn and step coordinates of the completed step.
 * @param signal - Active turn cancellation signal.
 * @returns The resolved continuation, feedback injection, or stop outcome.
 */
export async function requestStepReview(
  ctx: Context,
  spec: ResolvedStepReviewConfig,
  agent: Agent,
  position: StepPosition,
  signal: AbortSignal,
): Promise<StepReviewOutcome> {
  if (signal.aborted) return { kind: 'continue' }
  if (agent.session.header.origin === 'subagent') return { kind: 'continue' }
  if (ctx.agents.get(agent.id) !== agent) return { kind: 'continue' }

  const questionItem: AskUserQuestionItem = {
    id: spec.questionId,
    header: formatStepTemplate(spec.header, position),
    question: formatStepTemplate(spec.question, position),
    ...(spec.detail === undefined ? {} : { detail: formatStepTemplate(spec.detail, position) }),
    options: spec.options.map(option => ({
      label: option.label,
      ...(option.description === undefined ? {} : { description: option.description }),
    })),
  }

  let answer: AskUserQuestionAnswer
  try {
    answer = await ctx.userQuestions.ask({
      agent,
      signal,
      questions: [questionItem],
    })
  } catch (error: unknown) {
    if (signal.aborted) throw error
    if (error instanceof UserQuestionError) {
      if (error.code === 'ASK_CANCELLED') {
        return spec.onDismiss === 'stop' ? { kind: 'stop' } : { kind: 'continue' }
      }
      if (error.code === 'NO_PROVIDER') {
        return spec.onUnavailable === 'stop' ? { kind: 'stop' } : { kind: 'continue' }
      }
    }
    throw error
  }

  return interpretAnswer(spec, position, answer)
}

interface CompletedStepState {
  readonly turn: number
  readonly step: number
  evaluated: boolean
}

/**
 * Mount the `step-review` plugin onto the given Cordis context.
 *
 * The plugin observes `step/end` session events to record each completed step, then
 * intercepts both `agent/pre-step` (before a subsequent step in the same turn) and
 * `agent/turn-stopping` (after the final step of a turn before `turn/end` commits)
 * so every completed step is evaluated once before execution proceeds.
 *
 * @param ctx - Plugin context with `agents` and `userQuestions` injected.
 * @param config - User configuration validated by {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const spec = resolveConfig(config)
  const completedSteps = new WeakMap<Session, CompletedStepState>()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'step/end') {
      completedSteps.set(session, {
        turn: event.data.turn,
        step: event.data.step,
        evaluated: false,
      })
    } else if (event.type === 'turn/end') {
      completedSteps.delete(session)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    completedSteps.delete(agent.session)
  })

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const downstream = await next()
    if (downstream.kind === 'reject' || signal.aborted) return downstream

    const pending = completedSteps.get(agent.session)
    if (pending === undefined || pending.evaluated || pending.turn !== turn || pending.step !== step - 1) {
      return downstream
    }
    pending.evaluated = true

    const outcome = await requestStepReview(
      ctx,
      spec,
      agent,
      { turn: pending.turn, step: pending.step },
      signal,
    )
    switch (outcome.kind) {
      case 'continue':
        return downstream
      case 'feedback':
        return {
          ...downstream,
          messages: [...downstream.messages, outcome.message],
        }
      case 'stop':
        return { kind: 'reject' }
    }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    if (signal.aborted) return
    const pending = completedSteps.get(agent.session)
    if (pending === undefined || pending.evaluated || pending.turn !== turn) {
      return
    }
    pending.evaluated = true

    const outcome = await requestStepReview(
      ctx,
      spec,
      agent,
      { turn: pending.turn, step: pending.step },
      signal,
    )
    switch (outcome.kind) {
      case 'continue':
      case 'stop':
        return
      case 'feedback':
        agent.steer(outcome.message)
    }
  })
}

export default {
  name,
  inject,
  Config,
  apply,
}

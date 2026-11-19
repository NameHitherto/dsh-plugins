import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { brandString } from '@deepseek-ai/dsh-brand'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService, {
  UserQuestionError,
  type AskUserQuestionRequestEvent,
} from '@deepseek-ai/dsh-user-questions'
import StepReviewPlugin, {
  formatStepTemplate,
  resolveConfig,
  type Config,
} from '../src/index.ts'

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 8, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = brandString<ToolCallId>(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 8, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedMockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const next = this.script.shift()
    if (next === undefined) {
      throw new Error('ScriptedMockAdapter: script exhausted')
    }
    for (const chunk of next) {
      yield chunk
    }
  }
}

async function createTestHarness(script: StreamChunk[][], pluginConfig?: Config) {
  const ctx = new Context()
  const adapter = new ScriptedMockAdapter(script)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(StepReviewPlugin, pluginConfig ?? {})
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'echo',
    description: 'Echo input text.',
    parameters: { text: { type: 'string', required: true } },
    execute: async ({ text }) => [{ type: 'text', text }],
  }))
  return { ctx, adapter }
}

function sendPrompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

function sessionEvents(agent: Agent): readonly SessionEvent[] {
  return agent.session.snapshotEvents()
}

describe('dsh-step-review-plugin', () => {
  describe('resolveConfig & formatStepTemplate', () => {
    it('populates default configuration and interpolates {turn}/{step} placeholders', () => {
      const resolved = resolveConfig()
      expect(resolved.questionId).toBe('step-review')
      expect(resolved.options.length).toBeGreaterThanOrEqual(3)
      expect(formatStepTemplate(resolved.question, { turn: 2, step: 3 }))
        .toContain('第 2 轮第 3 步')
    })

    it('fails loud at load time when configuration is invalid', () => {
      expect(() => resolveConfig({ questionId: '   ' }))
        .toThrow(/questionId/)
      expect(() => resolveConfig({ options: [] }))
        .toThrow(/at least one evaluation option/)
      expect(() => resolveConfig({
        options: [
          { label: '重复选项', action: 'continue' },
          { label: '重复选项', action: 'stop' },
        ],
      })).toThrow(/duplicate option label/)
    })
  })

  describe('step pause and evaluation flow', () => {
    it('pauses after each step in a multi-step tool turn and resumes when the user selects continue', async () => {
      const { ctx, adapter } = await createTestHarness([
        toolCallResponse('call-1', 'echo', { text: 'tool-out' }),
        textResponse('final answer'),
      ])
      const agent = await ctx.agentLoop.create(brandString<SessionId>('session-continue'), {
        provider: 'mock',
        model: 'mock',
      })

      const askedQuestions: string[] = []
      ctx.on('user-questions/request', async (request: AskUserQuestionRequestEvent) => {
        const q = request.questions[0]!
        askedQuestions.push(q.question)
        return {
          answers: [{ id: q.id, selected: ['满意，继续执行'] }],
        }
      })

      sendPrompt(agent, 'run tool and finish')
      await agent.whenIdle()

      // Step 1 (tool call) and Step 2 (final answer) both paused for evaluation.
      expect(askedQuestions).toEqual([
        '智能体已完成第 1 轮第 1 步，请评价本步执行结果：',
        '智能体已完成第 1 轮第 2 步，请评价本步执行结果：',
      ])
      expect(adapter.requests).toHaveLength(2)
    })

    it('injects evaluation feedback into the next step when the user selects a feedback option', async () => {
      const { ctx, adapter } = await createTestHarness([
        textResponse('first draft'),
        textResponse('revised draft after review'),
      ])
      const agent = await ctx.agentLoop.create(brandString<SessionId>('session-feedback'), {
        provider: 'mock',
        model: 'mock',
      })

      const selections = ['需微调后继续', '满意，继续执行']
      const askedQuestions: string[] = []
      ctx.on('user-questions/request', async (request: AskUserQuestionRequestEvent) => {
        const q = request.questions[0]!
        askedQuestions.push(q.question)
        const choice = selections.shift() ?? '满意，继续执行'
        return {
          answers: [{ id: q.id, selected: [choice] }],
        }
      })

      sendPrompt(agent, 'write a draft')
      await agent.whenIdle()

      // Evaluated once after Step 1 (steering into Step 2 without double-prompting before Step 2),
      // and once after Step 2 before closing the turn.
      expect(askedQuestions).toEqual([
        '智能体已完成第 1 轮第 1 步，请评价本步执行结果：',
        '智能体已完成第 1 轮第 2 步，请评价本步执行结果：',
      ])
      expect(adapter.requests).toHaveLength(2)

      const loggedUserMessages = sessionEvents(agent).filter(e => e.type === 'user/message')
      const reviewMessage = loggedUserMessages.find(
        e => e.type === 'user/message' && e.data.source.kind === 'step-review',
      )
      expect(reviewMessage).toBeDefined()
      expect(
        reviewMessage?.type === 'user/message'
        && reviewMessage.data.content[0]?.type === 'text'
        && reviewMessage.data.content[0].text,
      ).toContain('需微调后继续')
    })

    it('stops the turn before the next LLM call when the user selects the stop option between steps', async () => {
      const { ctx, adapter } = await createTestHarness([
        toolCallResponse('call-stop', 'echo', { text: 'step-1' }),
        textResponse('should not run'),
      ])
      const agent = await ctx.agentLoop.create(brandString<SessionId>('session-stop'), {
        provider: 'mock',
        model: 'mock',
      })

      ctx.on('user-questions/request', async (request: AskUserQuestionRequestEvent) => {
        const q = request.questions[0]!
        return {
          answers: [{ id: q.id, selected: ['终止本轮执行'] }],
        }
      })

      sendPrompt(agent, 'start work')
      await agent.whenIdle()

      // Only Step 1 ran; Step 2 was rejected by the pre-step evaluation gate.
      expect(adapter.requests).toHaveLength(1)
      const turnEnd = sessionEvents(agent).find(e => e.type === 'turn/end')
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'blocked' })
    })

    it('applies onDismiss policy when the user dismisses the evaluation box (ASK_CANCELLED)', async () => {
      const { ctx, adapter } = await createTestHarness(
        [
          toolCallResponse('call-dismiss', 'echo', { text: 'step-1' }),
          textResponse('should not run'),
        ],
        { onDismiss: 'stop' },
      )
      const agent = await ctx.agentLoop.create(brandString<SessionId>('session-dismiss'), {
        provider: 'mock',
        model: 'mock',
      })

      ctx.on('user-questions/request', async () => {
        throw new UserQuestionError('user dismissed the question', 'ASK_CANCELLED')
      })

      sendPrompt(agent, 'test dismiss')
      await agent.whenIdle()

      expect(adapter.requests).toHaveLength(1)
      const turnEnd = sessionEvents(agent).find(e => e.type === 'turn/end')
      expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'blocked' })
    })
  })
})

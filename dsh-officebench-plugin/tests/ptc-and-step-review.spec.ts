import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc'
import ToolRuntime, { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionOptions } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StepReviewPlugin from '../../dsh-step-review-plugin/src/index.ts'
import OfficeBenchPlugin, { OFFICEBENCH_TOOL_NAMES, type OfficeBenchService } from '../src/index.ts'
import { calendarCreateEvent } from '../src/office/calendar.ts'
import { excelCreateNewFile, excelSetCell } from '../src/office/excel.ts'
import OfficeBenchToolsPlugin from '../src/tools-plugin.ts'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * In-process TypeScript PTC runtime using Node 24's built-in `stripTypeScriptTypes`
 * so tests exercise the real `PtcExecutor` (`run_code`), concurrency scheduling,
 * TypeScript SDK generation, and OfficeBench tool bindings deterministically.
 */
class InProcessTsPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'in-process-vm'

  resolve(request: PtcRunRequest): PtcRunSpec {
    return {
      ...request,
      cwd: request.cwd ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 30_000,
    }
  }

  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    const logs: string[] = []
    const sandbox: Record<string, unknown> = {
      Promise,
      Array,
      Object,
      Map,
      Set,
      Math,
      JSON,
      Number,
      String,
      Boolean,
      Error,
      inspect: (...args: unknown[]) => {
        logs.push(args.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') + '\n')
      },
    }

    for (const ns of request.bindings) {
      const target: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
      for (const [fnName, fn] of Object.entries(ns.functions)) {
        target[fnName] = async (...args: unknown[]) =>
          fn(...args.map(arg => (arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)))))
      }
      sandbox[ns.global] = target
    }

    try {
      const wrappedTs = `async function __main__(): Promise<unknown> {\n${request.program}\n}\n__main__()`
      const js = stripTypeScriptTypes(wrappedTs)
      const rawValue = await (runInNewContext(js, sandbox) as Promise<unknown>)
      const value = rawValue === undefined ? undefined : JSON.parse(JSON.stringify(rawValue))
      return value === undefined ? { logs } : { logs, value: value as PtcRunResult['value'] }
    } catch (error: unknown) {
      return {
        logs,
        error: {
          kind: 'program',
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
}

async function createBatchTaskDataset(): Promise<{ datasetDir: string; runsDir: string }> {
  const root = await makeTempDir('dsh-ob-ptc-')
  const datasetDir = join(root, 'OfficeBench')
  const runsDir = join(root, 'runs')

  const taskDir = join(datasetDir, 'tasks', '3-99')
  await mkdir(join(taskDir, 'subtasks'), { recursive: true })
  await mkdir(join(taskDir, 'testbed', 'data'), { recursive: true })
  await mkdir(join(taskDir, 'testbed', 'emails'), { recursive: true })
  await mkdir(join(taskDir, 'testbed', 'calendar'), { recursive: true })

  await excelCreateNewFile(join(taskDir, 'testbed'), 'data/sales.xlsx')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 1, 1, 'Region')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 1, 2, 'Revenue')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 2, 1, 'North')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 2, 2, '120')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 3, 1, 'South')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 3, 2, '180')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 4, 1, 'West')
  await excelSetCell(join(taskDir, 'testbed'), 'data/sales.xlsx', 4, 2, '200')

  await calendarCreateEvent(join(taskDir, 'testbed'), 'Bob', 'Daily Standup', '2020-05-05 09:00:00', '2020-05-05 09:30:00')

  await writeFile(
    join(taskDir, 'subtasks', '0.json'),
    JSON.stringify({
      username: 'Bob',
      date: '2020-05-05',
      weekday: 'Tuesday',
      time: '08:45:00',
      task: 'Compute total revenue from /testbed/data/sales.xlsx, write Total and 500 in row 5, email Alice the total, schedule a non-overlapping Q2 Review on 2020-05-05 14:00:00-15:00:00, and write 500 to /testbed/data/answer.txt.',
      evaluation: [
        {
          function: 'evaluate_excel_cell_value',
          args: {
            file: 'data/sales.xlsx',
            matches: [
              { row: '5', col: '1', value: 'Total' },
              { row: '5', col: '2', value: '500' },
            ],
          },
        },
        {
          function: 'evaluate_contain',
          args: { doc_type: 'email', username: 'Alice', keywords: ['500'] },
        },
        {
          function: 'evaluate_calendar_no_overlap',
          args: { username: 'Bob' },
        },
        {
          function: 'evaluate_contain',
          args: { doc_type: 'ics', file: 'calendar/Bob.ics', keywords: ['Q2 Review'] },
        },
        {
          function: 'evaluate_contain',
          args: { doc_type: 'txt', file: 'data/answer.txt', keywords: ['500'] },
        },
      ],
    }, null, 2),
    'utf8',
  )

  return { datasetDir, runsDir }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('PTC batch execution + OfficeBench tools + Step Review composition', () => {
  it('exposes all 24 tools to PTC, injects task virtual clock context, runs a batch TypeScript program, and passes live evaluation', async () => {
    const { datasetDir, runsDir } = await createBatchTaskDataset()
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(OfficeBenchPlugin, { datasetDir, runsDir })
      const ob = ctx.get('officebench') as OfficeBenchService

      const created = await ob.manager.createRun('3-99/0')
      ob.indexRun(created.run)

      const runCwd = created.run.testbedDir
      ctx.provide('workingDirectory', {
        defaultDirectory: runCwd,
        get: () => runCwd,
        ensure: async () => runCwd,
      } as never)

      new InProcessTsPtcRuntime(ctx)
      const ptcExecutor = new PtcExecutor(ctx)
      ctx.tools.setExecutor(ptcExecutor)

      const sessionId = brandString<SessionId>('session-ptc-1')
      const ptcEvents: Array<{ type: string; data: unknown }> = []
      let seq = 0
      const sessionStub = {
        id: sessionId,
        cwd: runCwd,
        header: { cwd: runCwd, origin: 'user' },
        append: (type: string, data: unknown) => {
          if (type.startsWith('tool/ptc-')) ptcEvents.push({ type, data })
          return { seq: ++seq }
        },
      } as never as Session
      const fakeAgent = {
        id: 'agent-1',
        ctx,
        session: sessionStub,
      } as never as Agent

      const scope = createScope(ctx, fakeAgent)
      await scope.ctx.plugin(OfficeBenchToolsPlugin)

      // All 24 OfficeBench tools are registered in ctx.tools for this agent scope
      for (const toolName of OFFICEBENCH_TOOL_NAMES) {
        expect(ctx.tools.get(toolName, fakeAgent)).toBeDefined()
      }

      // System prompt includes instructions, run virtual clock context, and run_code tool SDK
      const assembled = await ctx.systemPrompt.assemble({ scope: fakeAgent, agent: fakeAgent })
      const rendered = renderPrompt(assembled)
      expect(rendered).toContain('OfficeBench')
      expect(rendered).toContain('run_code')
      expect(rendered).toContain('excel_read_file')
      const contextText = assembled.contexts.map(c => c.text).join('\n')
      expect(contextText).toContain('3-99/0')
      expect(contextText).toContain('2020-05-05')
      expect(contextText).toContain('Tuesday')

      // Model writes one TypeScript program that batch-calls multiple OfficeBench tools
      const program = `
        const [files, sheet, cal] = await Promise.all([
          tools.officebench_list_files({}),
          tools.excel_read_file({ file_path: '/testbed/data/sales.xlsx' }),
          tools.calendar_list_events({ username: 'Bob' }),
        ]);

        let total: number = 0;
        for (const row of sheet.rows.slice(1)) {
          const val = Number(row[1]);
          if (!Number.isNaN(val)) total += val;
        }

        const updates: Array<[number, number, string]> = [
          [5, 1, 'Total'],
          [5, 2, String(total)],
        ];
        for (const [r, c, text] of updates) {
          await tools.excel_set_cell({
            file_path: '/testbed/data/sales.xlsx',
            row_idx: r,
            column_idx: c,
            text,
          });
        }

        await tools.email_send_email({
          sender: 'Bob',
          recipient: 'Alice',
          subject: 'Q2 Total Revenue',
          content: 'Total revenue across all regions is ' + total,
        });

        await tools.calendar_create_event({
          user: 'Bob',
          summary: 'Q2 Review',
          time_start: '2020-05-05 14:00:00',
          time_end: '2020-05-05 15:00:00',
        });

        await tools.finish_task({ answer: String(total) });
        inspect({ fileCount: files.files.length, existingEvents: cal.events.length, total });
        return { total };
      `

      const batch = await ptcExecutor.execute({
        calls: [{
          type: 'tool_call',
          id: brandString<ToolCallId>('call-ptc-1'),
          name: RUN_CODE_NAME,
          arguments: JSON.stringify({
            description: 'Batch read sales & calendar, update totals, send email, schedule Q2 review, finish task',
            code: program,
          }),
        }],
        signal: new AbortController().signal,
        agent: fakeAgent,
      })

      expect(batch.results).toHaveLength(1)
      expect(batch.results[0]?.result.isError, JSON.stringify(batch.results[0])).not.toBe(true)
      // Verify nested OfficeBench subcalls emitted PTC lifecycle events (3 parallel reads + 2 excel sets + email + calendar + finish = 8 calls)
      expect(ptcEvents.length).toBeGreaterThanOrEqual(8)

      // Live OfficeBench evaluator passes all 5 rules!
      const { report } = await ob.manager.evaluateRun(created.run.runId)
      expect(report.rules.filter(r => !r.passed), JSON.stringify({ batch: batch.results[0], rules: report.rules }, null, 2)).toEqual([])
      expect(report.passed).toBe(true)
      expect(report.passedCount).toBe(5)
      expect(report.totalCount).toBe(5)

      await scope.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('composes with dsh-step-review-plugin so a human can inspect & evaluate during a step-review pause', async () => {
    const { datasetDir, runsDir } = await createBatchTaskDataset()
    const ctx = new Context()
    try {
      await ctx.plugin(OfficeBenchPlugin, { datasetDir, runsDir })
      const ob = ctx.get('officebench') as OfficeBenchService
      const created = await ob.manager.createRun('3-99/0')
      ob.indexRun(created.run)

      let pausedEvaluationPassed: boolean | undefined
      const askSpy = vi.fn(async (
        _session: Session,
        _questions: AskUserQuestionItem[],
        _options?: AskUserQuestionOptions,
      ): Promise<AskUserQuestionAnswer> => {
        // While paused at the step-review gate, the user inspects & evaluates the run live!
        const { report: liveEval } = await ob.manager.evaluateRun(created.run.runId)
        pausedEvaluationPassed = liveEval.passed
        return {
          answers: [{
            id: 'step-review',
            selected: ['Steer with feedback'],
            custom: 'Also double check row 5 formatting before finishing.',
          }],
        }
      })

      const session = {
        id: brandString<SessionId>('session-review-1'),
        cwd: created.run.testbedDir,
        header: { origin: 'user' },
      } as never as Session
      const agent = {
        id: 'agent-ob',
        session,
      } as never as Agent

      ctx.provide('userQuestions', { ask: askSpy } as never)
      ctx.provide('agents', {
        get: (id: string) => (id === agent.id ? agent : undefined),
        list: () => [agent],
      } as never)

      await ctx.plugin(StepReviewPlugin, {
        options: [
          { label: 'Continue', action: 'continue' },
          { label: 'Steer with feedback', action: 'feedback', messagePrefix: 'Reviewer note: ' },
          { label: 'Stop', action: 'stop' },
        ],
      })

      // Emit session/event step/end for turn 1, step 1
      ctx.emit('session/event', session, {
        type: 'step/end',
        data: { turn: 1, step: 1 },
      } as never)

      // Trigger agent/pre-step waterfall for turn 1, step 2
      const decision = await ctx.waterfall(
        'agent/pre-step',
        {
          agent,
          turn: 1,
          step: 2,
          signal: new AbortController().signal,
        } as never,
        async (): Promise<PreStepDecision> => ({ kind: 'proceed', messages: [] }),
      )

      expect(askSpy).toHaveBeenCalledTimes(1)
      expect(pausedEvaluationPassed).toBe(false)
      expect(decision.kind).toBe('proceed')
      if (decision.kind === 'proceed') {
        expect(JSON.stringify(decision.messages)).toContain('Also double check row 5 formatting')
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

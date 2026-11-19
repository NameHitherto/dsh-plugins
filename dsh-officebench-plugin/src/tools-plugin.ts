/**
 * Scoped OfficeBench tools plugin (`dsh-officebench-plugin/tools`).
 *
 * Mounted inside `preset-officebench` (alongside `@deepseek-ai/dsh-tool-executor-ptc`)
 * so sessions using the `officebench` preset receive the complete OfficeBench toolset,
 * PTC batch-calling guidance, and per-session OfficeBench virtual clock/user context.
 *
 * @module dsh-officebench-plugin/tools-plugin
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { resolveConfig } from './config.ts'
import { createOfficeBenchTools } from './tools.ts'
import type { OfficeBenchRunRecord, ResolvedOfficeBenchConfig } from './types.ts'

/** Cordis plugin name for the scoped OfficeBench toolset. */
export const name = 'officebench-tools'

/** Required services: tool registry, system prompt, and session working directory. */
export const inject = ['tools', 'systemPrompt', 'workingDirectory']

const OFFICEBENCH_INSTRUCTIONS = [
  '## OfficeBench Environment & Programmatic Tool Calling',
  '',
  'You are operating inside an isolated OfficeBench testbed mapped as `/testbed`:',
  '- Documents and spreadsheets live under `/testbed/data/` (Excel `.xlsx`, Word `.docx`, PDF `.pdf`, images `.png`/`.jpg`, text `.txt`).',
  '- Mailboxes live under `/testbed/emails/<username>/*.eml`.',
  '- Calendars live under `/testbed/calendar/<username>.ics`.',
  '',
  'When solving a task with `run_code`:',
  '- Batch related tool calls inside one TypeScript program instead of taking one tool call per turn.',
  '- Use `await Promise.all([...])` for independent read-only operations (`officebench_list_files`, `excel_read_file`, `word_read_file`, `pdf_read_file`, `email_list_emails`, `email_read_email`, `calendar_list_events`, `ocr_recognize_file`).',
  '- Use sequential `await` loops for mutating operations (`excel_set_cell`, `word_write_to_file`, `email_send_email`, `calendar_create_event`, `calendar_delete_event`).',
  '- `excel_read_file` returns a 0-indexed `rows` matrix for clean sorting/filtering/computation; remember `excel_set_cell` and `excel_delete_cell` take **1-based** `row_idx` and `column_idx`.',
  '- Calendar timestamps use `"YYYY-MM-DD HH:MM:SS"`.',
  '- Call `inspect(...)` on concise summaries or verification checks so you can verify your work before finishing.',
  '- When finished, call `await tools.finish_task({ answer })` (provide `answer` whenever the task asks a question so it is written to `/testbed/data/answer.txt`; omit `answer` for file-only tasks).',
].join('\n')

function readAdjacentRunRecord(cwd: string): OfficeBenchRunRecord | undefined {
  const metaPath = join(resolve(cwd), '..', 'run.json')
  if (!existsSync(metaPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { record?: OfficeBenchRunRecord }
    const record = parsed.record
    if (record === undefined) return undefined
    const normA = process.platform === 'win32' ? resolve(record.testbedDir).toLowerCase() : resolve(record.testbedDir)
    const normB = process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd)
    return normA === normB ? record : undefined
  } catch (_error: unknown) {
    return undefined
  }
}

interface OptionalOfficeBenchHostService {
  getConfig(): ResolvedOfficeBenchConfig
  getRunForCwdSync(cwd: string): OfficeBenchRunRecord | undefined
}

function getHostService(ctx: Context): OptionalOfficeBenchHostService | undefined {
  const candidate: unknown = ctx.get('officebench')
  if (
    typeof candidate === 'object'
    && candidate !== null
    && 'getConfig' in candidate
    && typeof candidate.getConfig === 'function'
    && 'getRunForCwdSync' in candidate
    && typeof candidate.getRunForCwdSync === 'function'
  ) {
    return candidate as OptionalOfficeBenchHostService
  }
  return undefined
}

/**
 * Mount the OfficeBench tools and prompt contributions into the current Cordis scope.
 *
 * @param ctx - Scoped or root Cordis context with `tools`, `systemPrompt`, and `workingDirectory`.
 */
export function apply(ctx: Context): void {
  const fallbackConfig = resolveConfig()
  const getConfig = (): ResolvedOfficeBenchConfig => getHostService(ctx)?.getConfig() ?? fallbackConfig

  const tools = createOfficeBenchTools({
    getConfig,
    resolveTestbedDir: async (exec) => {
      if (exec.agent === undefined) {
        return ctx.workingDirectory.defaultDirectory
      }
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    },
  })

  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), `officebench: tool ${tool.name}`)
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'officebench:instructions',
    order: 1500,
    interpolate: false,
    text: OFFICEBENCH_INSTRUCTIONS,
  }), 'officebench: instructions section')

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'officebench:task-context',
    order: 150,
    required: true,
    interpolate: false,
    text: (context) => {
      if (context.agent === undefined) return ''
      const cwd = ctx.workingDirectory.get(context.agent.session)
      const record = getHostService(ctx)?.getRunForCwdSync(cwd) ?? readAdjacentRunRecord(cwd)
      if (record === undefined) return ''
      return [
        `Today is ${record.date} (${record.weekday}). The current time is ${record.time}. You are an AI assistant for user ${record.username}.`,
        `Active OfficeBench task: ${record.taskKey} (run ${record.runId}).`,
        `Testbed directory: ${record.testbedDir} (all /testbed/... paths resolve here).`,
      ].join('\n')
    },
  }), 'officebench: task-context')
}

export default {
  name,
  inject,
  apply,
}

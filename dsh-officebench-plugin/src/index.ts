/**
 * Host entry point for `dsh-officebench-plugin`.
 *
 * Provides the `ctx.officebench` service (dataset discovery, isolated testbed
 * runs, live evaluation, and structured state inspection), mounts the
 * authenticated `/officebench` RPC channel on `ctx.connection` when running
 * under the Web GUI host, and optionally registers OfficeBench tools globally
 * for non-preset (e.g. headless) profiles.
 *
 * @module dsh-officebench-plugin
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { Config, resolveConfig } from './config.ts'
import { OfficeBenchManager } from './dataset.ts'
import { OfficeBenchError } from './path-resolver.ts'
import * as toolsPlugin from './tools-plugin.ts'
import type {
  OfficeBenchAppTag,
  OfficeBenchConfig,
  OfficeBenchRunRecord,
  ResolvedOfficeBenchConfig,
} from './types.ts'

export { Config, defaultRunsDir, resolveConfig } from './config.ts'
export { buildSuggestedTaskPrompt, listTestbedFiles, OfficeBenchManager } from './dataset.ts'
export { evaluateSafeComparator, evaluateTaskRules, resolveEvaluationFilePath } from './evaluator.ts'
export { OfficeBenchError, resolveTestbedPath, toPosixRelative, toVirtualTestbedPath } from './path-resolver.ts'
export { createOfficeBenchTools, OFFICEBENCH_TOOL_NAMES } from './tools.ts'
export type {
  CreateRunResponse,
  EvaluationReport,
  EvaluationRuleResult,
  OfficeBenchAppTag,
  OfficeBenchConfig,
  OfficeBenchEvaluationRule,
  OfficeBenchRpcEndpoint,
  OfficeBenchRpcMap,
  OfficeBenchRunRecord,
  OfficeBenchStatus,
  OfficeBenchSubtaskJson,
  OfficeBenchTaskDetail,
  OfficeBenchTaskSummary,
  ResolvedOfficeBenchConfig,
  SessionRunContextResponse,
  TestbedCalendarEvent,
  TestbedChangeStatus,
  TestbedEmailSummary,
  TestbedFileChange,
  TestbedFileEntry,
  TestbedOverview,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** OfficeBench dataset, isolated run manager, and live evaluator. */
    officebench: OfficeBenchService
  }
}

/** Stable Cordis plugin name. */
export const name = 'officebench'

/** RPC channel prefix registered on `ctx.connection`. */
export const OFFICEBENCH_RPC_CHANNEL = '/officebench'

function normalizePathKey(p: string): string {
  const resolved = resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>
  }
  return {}
}

function requireStringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OfficeBenchError(`Missing or invalid "${field}" string`, 'OFFICEBENCH_BAD_REQUEST')
  }
  return value.trim()
}

function optionalStringField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new OfficeBenchError(`Field "${field}" must be a string`, 'OFFICEBENCH_BAD_REQUEST')
  }
  return value
}

function optionalAppCount(payload: Record<string, unknown>): number | undefined {
  const value = payload.appCount
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new OfficeBenchError('Field "appCount" must be an integer', 'OFFICEBENCH_BAD_REQUEST')
  }
  return value
}

function optionalAppTag(payload: Record<string, unknown>): OfficeBenchAppTag | undefined {
  const value = payload.appTag
  if (value === undefined || value === null || value === '') return undefined
  if (
    value === 'excel' || value === 'word' || value === 'pdf' || value === 'ocr'
    || value === 'email' || value === 'calendar' || value === 'shell'
  ) {
    return value
  }
  throw new OfficeBenchError(`Invalid "appTag": ${String(value)}`, 'OFFICEBENCH_BAD_REQUEST')
}

/**
 * Cordis service hosting the OfficeBench dataset catalog, isolated run manager,
 * and synchronous `cwd -> run` lookup used by `systemPrompt.context`.
 */
export class OfficeBenchService extends Service {
  readonly manager: OfficeBenchManager
  private readonly resolvedConfig: ResolvedOfficeBenchConfig
  private readonly cwdIndex = new Map<string, OfficeBenchRunRecord>()

  constructor(ctx: Context, config: ResolvedOfficeBenchConfig) {
    super(ctx, 'officebench')
    this.resolvedConfig = config
    this.manager = new OfficeBenchManager(config)
  }

  protected async [Service.init](): Promise<void> {
    await this.manager.initialize()
    const runs = await this.manager.listRuns()
    for (const run of runs) {
      this.cwdIndex.set(normalizePathKey(run.testbedDir), run)
    }
  }

  /** Return the validated plugin configuration. */
  getConfig(): ResolvedOfficeBenchConfig {
    return this.resolvedConfig
  }

  /** Record or update an in-memory `testbedDir -> run` index entry. */
  indexRun(run: OfficeBenchRunRecord): void {
    this.cwdIndex.set(normalizePathKey(run.testbedDir), run)
  }

  /** Remove a deleted run from the in-memory `testbedDir -> run` index. */
  unindexRun(runId: string): void {
    for (const [key, value] of this.cwdIndex.entries()) {
      if (value.runId === runId) {
        this.cwdIndex.delete(key)
      }
    }
  }

  /**
   * Synchronously resolve the active OfficeBench run for a Session's working directory
   * so `ctx.systemPrompt.context` can inject task clock/user facts with zero async delay.
   */
  getRunForCwdSync(cwd: string): OfficeBenchRunRecord | undefined {
    const key = normalizePathKey(cwd)
    const cached = this.cwdIndex.get(key)
    if (cached !== undefined) return cached
    const metaPath = join(resolve(cwd), '..', 'run.json')
    if (!existsSync(metaPath)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { record?: OfficeBenchRunRecord }
      if (parsed.record !== undefined && normalizePathKey(parsed.record.testbedDir) === key) {
        this.cwdIndex.set(key, parsed.record)
        return parsed.record
      }
    } catch (_error: unknown) {
      // Ignore unreadable or non-OfficeBench files.
    }
    return undefined
  }

  /** Dispatch one `/officebench/<endpoint>` RPC call. */
  async handleRpc(endpoint: string, rawPayload: unknown): Promise<ConnectionRpcHandlerResult> {
    try {
      const payload = asRecord(rawPayload)
      switch (endpoint) {
        case 'status/get': {
          const value = await this.manager.getStatus()
          return { ok: true, value }
        }
        case 'config/set-dataset-dir': {
          const dir = typeof payload.datasetDir === 'string' ? payload.datasetDir : ''
          const value = await this.manager.setDatasetDir(dir)
          return { ok: true, value }
        }
        case 'tasks/list': {
          const search = optionalStringField(payload, 'search')
          const appCount = optionalAppCount(payload)
          const appTag = optionalAppTag(payload)
          const value = await this.manager.listTasks({
            ...(search === undefined ? {} : { search }),
            ...(appCount === undefined ? {} : { appCount }),
            ...(appTag === undefined ? {} : { appTag }),
          })
          return { ok: true, value }
        }
        case 'tasks/get': {
          const taskKey = requireStringField(payload, 'taskKey')
          const task = await this.manager.getTask(taskKey)
          return { ok: true, value: { task } }
        }
        case 'runs/list': {
          const runs = await this.manager.listRuns()
          for (const run of runs) this.indexRun(run)
          return { ok: true, value: { runs } }
        }
        case 'runs/create': {
          const taskKey = requireStringField(payload, 'taskKey')
          const sessionId = optionalStringField(payload, 'sessionId')
          const created = await this.manager.createRun(taskKey, sessionId)
          this.indexRun(created.run)
          return { ok: true, value: created }
        }
        case 'runs/bind-session': {
          const runId = requireStringField(payload, 'runId')
          const sessionId = requireStringField(payload, 'sessionId')
          const run = await this.manager.bindSession(runId, sessionId)
          this.indexRun(run)
          return { ok: true, value: { run } }
        }
        case 'runs/for-session': {
          const sessionId = requireStringField(payload, 'sessionId')
          const cwd = optionalStringField(payload, 'cwd')
          const value = await this.manager.inspectSession(sessionId, cwd)
          if (value.run !== null) this.indexRun(value.run)
          return { ok: true, value }
        }
        case 'runs/inspect': {
          const runId = requireStringField(payload, 'runId')
          const value = await this.manager.inspectRun(runId)
          if (value.run !== null) this.indexRun(value.run)
          return { ok: true, value }
        }
        case 'runs/evaluate': {
          const runId = requireStringField(payload, 'runId')
          const value = await this.manager.evaluateRun(runId)
          this.indexRun(value.run)
          return { ok: true, value }
        }
        case 'runs/reset': {
          const runId = requireStringField(payload, 'runId')
          const value = await this.manager.resetRun(runId)
          if (value.run !== null) this.indexRun(value.run)
          return { ok: true, value }
        }
        case 'runs/delete': {
          const runId = requireStringField(payload, 'runId')
          const deleted = await this.manager.deleteRun(runId)
          this.unindexRun(runId)
          return { ok: true, value: { deleted } }
        }
        default:
          return {
            ok: false,
            error: {
              code: 'officebench/unknown-endpoint',
              message: `Unknown OfficeBench RPC endpoint: ${endpoint}`,
              details: { endpoint },
            },
          }
      }
    } catch (error: unknown) {
      if (error instanceof OfficeBenchError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: {},
          },
        }
      }
      return {
        ok: false,
        error: {
          code: 'officebench/internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }
}

/**
 * Mount the `officebench` Host plugin onto the given Cordis context.
 *
 * @param ctx - Host plugin context.
 * @param config - User configuration validated by {@link Config}.
 */
export function apply(ctx: Context, config: OfficeBenchConfig = {}): void {
  const spec = resolveConfig(config)
  const service = new OfficeBenchService(ctx, spec)

  // Mount the authenticated browser RPC channel when running in a Web/Desktop Host.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    const connection = webCtx.connection
    webCtx.effect(
      () => connection.rpc.handle(OFFICEBENCH_RPC_CHANNEL, async (endpoint, payload) => {
        return await service.handleRpc(endpoint, payload)
      }),
      'officebench: /officebench rpc channel',
    )
  })

  // Optional global registration for non-preset profiles (such as headless CLI).
  if (spec.registerToolsGlobally) {
    ctx.plugin(toolsPlugin)
  }
}

export default {
  name,
  Config,
  apply,
}

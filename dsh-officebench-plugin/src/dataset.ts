/**
 * OfficeBench dataset scanner, isolated per-run testbed lifecycle, file-change
 * diffing, and structured testbed inspection for the Web UI.
 *
 * @module dsh-officebench-plugin/dataset
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { readCalendarFileHost } from './office/calendar.ts'
import { parseEmlFileHost } from './office/email.ts'
import { findLibreOfficeBinary } from './office/excel.ts'
import { findTesseractBinary } from './office/ocr.ts'
import { findPythonWithPyMuPdf } from './office/pdf.ts'
import { evaluateTaskRules } from './evaluator.ts'
import { OfficeBenchError } from './path-resolver.ts'
import type {
  CreateRunResponse,
  EvaluationReport,
  OfficeBenchAppTag,
  OfficeBenchRunRecord,
  OfficeBenchStatus,
  OfficeBenchSubtaskJson,
  OfficeBenchTaskDetail,
  OfficeBenchTaskSummary,
  ResolvedOfficeBenchConfig,
  SessionRunContextResponse,
  TestbedCalendarEvent,
  TestbedEmailSummary,
  TestbedFileChange,
  TestbedFileEntry,
  TestbedOverview,
} from './types.ts'

interface PersistedSettings {
  datasetDir?: string
}

interface PersistedRunMeta {
  record: OfficeBenchRunRecord
  initialHashes: Record<string, string>
}

const RUNS_META_FILENAME = 'run.json'
const SETTINGS_FILENAME = 'settings.json'

function normalizePathKey(p: string): string {
  const resolved = resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function parseTaskIdParts(taskId: string): readonly [number, number] | undefined {
  const match = /^(\d+)-(\d+)$/.exec(taskId)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2])]
}

function compareTasks(a: { taskId: string; subtaskId: string }, b: { taskId: string; subtaskId: string }): number {
  const pa = parseTaskIdParts(a.taskId)
  const pb = parseTaskIdParts(b.taskId)
  if (pa !== undefined && pb !== undefined) {
    if (pa[0] !== pb[0]) return pa[0] - pb[0]
    if (pa[1] !== pb[1]) return pa[1] - pb[1]
  } else {
    const cmp = a.taskId.localeCompare(b.taskId)
    if (cmp !== 0) return cmp
  }
  const na = Number(a.subtaskId)
  const nb = Number(b.subtaskId)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.subtaskId.localeCompare(b.subtaskId)
}

function inferAppTags(
  json: OfficeBenchSubtaskJson,
  files: readonly TestbedFileEntry[],
): readonly OfficeBenchAppTag[] {
  const tags = new Set<OfficeBenchAppTag>()
  const text = json.task.toLowerCase()

  for (const file of files) {
    if (file.category === 'emails' || file.extension === '.eml') tags.add('email')
    if (file.category === 'calendar' || file.extension === '.ics') tags.add('calendar')
    if (file.extension === '.xlsx' || file.extension === '.xls') tags.add('excel')
    if (file.extension === '.docx' || file.extension === '.doc') tags.add('word')
    if (file.extension === '.pdf') tags.add('pdf')
    if (file.extension === '.png' || file.extension === '.jpg' || file.extension === '.jpeg') tags.add('ocr')
  }

  for (const rule of json.evaluation) {
    const docType = typeof rule.args.doc_type === 'string' ? rule.args.doc_type : ''
    const file = typeof rule.args.file === 'string' ? rule.args.file.toLowerCase() : ''
    if (docType === 'xlsx' || rule.function.includes('excel') || file.endsWith('.xlsx')) tags.add('excel')
    if (docType === 'docx' || docType === 'doc' || file.endsWith('.docx')) tags.add('word')
    if (docType === 'pdf' || file.endsWith('.pdf')) tags.add('pdf')
    if (docType === 'email') tags.add('email')
    if (docType === 'ics' || rule.function.includes('calendar') || file.endsWith('.ics')) tags.add('calendar')
  }

  if (/\bexcel\b|\bspreadsheet\b|\.xlsx\b/.test(text)) tags.add('excel')
  if (/\bword\b|\.docx\b/.test(text)) tags.add('word')
  if (/\bpdf\b|\.pdf\b/.test(text)) tags.add('pdf')
  if (/\bemail\b|\bmail\b|\bsend\b/.test(text)) tags.add('email')
  if (/\bcalendar\b|\bschedule\b|\bmeeting\b|\bevent\b/.test(text)) tags.add('calendar')
  if (/\bimage\b|\bphoto\b|\bpicture\b|\bocr\b|\bscan\b/.test(text)) tags.add('ocr')

  const order: OfficeBenchAppTag[] = ['excel', 'word', 'pdf', 'ocr', 'email', 'calendar', 'shell']
  return order.filter(tag => tags.has(tag))
}

function classifyCategory(relativePath: string): TestbedFileEntry['category'] {
  if (relativePath.startsWith('data/')) return 'data'
  if (relativePath.startsWith('emails/')) return 'emails'
  if (relativePath.startsWith('calendar/')) return 'calendar'
  return 'other'
}

/** Recursively enumerate all files under `rootDir` in deterministic POSIX order. */
export async function listTestbedFiles(rootDir: string): Promise<TestbedFileEntry[]> {
  if (!existsSync(rootDir)) return []
  const results: TestbedFileEntry[] = []

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const info = await stat(fullPath)
        const rel = relative(rootDir, fullPath).split(sep).join('/')
        results.push({
          relativePath: rel,
          category: classifyCategory(rel),
          sizeBytes: info.size,
          extension: extname(entry.name).toLowerCase(),
        })
      }
    }
  }

  await walk(rootDir)
  return results
}

async function computeFileHashes(rootDir: string): Promise<Record<string, string>> {
  const files = await listTestbedFiles(rootDir)
  const hashes: Record<string, string> = {}
  for (const file of files) {
    const bytes = await readFile(join(rootDir, file.relativePath))
    hashes[file.relativePath] = createHash('sha256').update(bytes).digest('hex')
  }
  return hashes
}

/**
 * Format the initial user prompt sent to the DSH agent for an OfficeBench task.
 */
export function buildSuggestedTaskPrompt(task: OfficeBenchTaskDetail): string {
  const fileList = task.initialFiles.length === 0
    ? '(no initial files)'
    : task.initialFiles.map(file => `- /testbed/${file.relativePath}`).join('\n')
  return [
    `[OfficeBench ${task.key}]`,
    `Task: ${task.task}`,
    '',
    `User: ${task.username} | Date: ${task.date} (${task.weekday}) | Time: ${task.time}`,
    'Initial testbed files:',
    fileList,
    '',
    'Solve this task by writing concise TypeScript code in `run_code` to batch-call the OfficeBench tools (`tools.excel_*`, `tools.word_*`, `tools.pdf_*`, `tools.ocr_*`, `tools.email_*`, `tools.calendar_*`, `tools.officebench_*`, `tools.shell_command`). Call `tools.finish_task({ answer })` when complete (pass the answer string if the task asks a question).',
  ].join('\n')
}

/**
 * Stateful manager for OfficeBench datasets, isolated run sandboxes, session
 * bindings, and live evaluations.
 */
export class OfficeBenchManager {
  private datasetDir: string
  private readonly runsDir: string
  private readonly config: ResolvedOfficeBenchConfig
  private taskCache: Map<string, OfficeBenchTaskDetail> | undefined
  private capabilitiesCache: OfficeBenchStatus['capabilities'] | undefined

  constructor(config: ResolvedOfficeBenchConfig) {
    this.config = config
    this.runsDir = config.runsDir
    this.datasetDir = config.datasetDir
  }

  /** Load any persisted UI datasetDir override if `config.datasetDir` was left empty. */
  async initialize(): Promise<void> {
    await mkdir(this.runsDir, { recursive: true })
    if (this.datasetDir === '') {
      const settings = await this.readSettings()
      if (settings.datasetDir !== undefined && settings.datasetDir.trim() !== '') {
        this.datasetDir = resolve(settings.datasetDir.trim())
      }
    }
  }

  /** Return the validated plugin configuration. */
  getConfig(): ResolvedOfficeBenchConfig {
    return this.config
  }

  /** Current configured dataset directory (may be empty if unconfigured). */
  getDatasetDir(): string {
    return this.datasetDir
  }

  /** Update the dataset directory at runtime and persist it to `<runsDir>/settings.json`. */
  async setDatasetDir(nextDir: string): Promise<OfficeBenchStatus> {
    const trimmed = nextDir.trim()
    this.datasetDir = trimmed === '' ? '' : resolve(trimmed)
    this.taskCache = undefined
    await this.writeSettings({ datasetDir: this.datasetDir })
    return await this.getStatus()
  }

  private async readSettings(): Promise<PersistedSettings> {
    const settingsPath = join(this.runsDir, SETTINGS_FILENAME)
    if (!existsSync(settingsPath)) return {}
    try {
      const parsed: unknown = JSON.parse(await readFile(settingsPath, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        return typeof record.datasetDir === 'string' ? { datasetDir: record.datasetDir } : {}
      }
    } catch (_error: unknown) {
      // Ignore corrupt settings file and fall back to defaults.
    }
    return {}
  }

  private async writeSettings(settings: PersistedSettings): Promise<void> {
    await mkdir(this.runsDir, { recursive: true })
    await writeFile(join(this.runsDir, SETTINGS_FILENAME), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }

  private async probeCapabilities(): Promise<OfficeBenchStatus['capabilities']> {
    if (this.capabilitiesCache !== undefined) return this.capabilitiesCache
    const [libreOffice, tesseractCli, pythonPyMuPdf] = await Promise.all([
      findLibreOfficeBinary(this.config.libreOfficePath),
      findTesseractBinary(this.config.tesseractPath),
      findPythonWithPyMuPdf(this.config.pythonPath),
    ])
    this.capabilitiesCache = {
      libreOffice: libreOffice !== undefined,
      tesseractCli: tesseractCli !== undefined,
      pythonPyMuPdf: pythonPyMuPdf !== undefined,
    }
    return this.capabilitiesCache
  }

  /** Inspect dataset validity, task count, and host conversion/OCR capabilities. */
  async getStatus(): Promise<OfficeBenchStatus> {
    const capabilities = await this.probeCapabilities()
    if (this.datasetDir === '') {
      return {
        datasetDir: '',
        datasetValid: false,
        datasetError: 'Dataset directory is not configured. Set `datasetDir` in the workbench or `OFFICEBENCH_DIR`.',
        taskCount: 0,
        runsDir: this.runsDir,
        capabilities,
      }
    }
    const tasksRoot = join(this.datasetDir, 'tasks')
    if (!existsSync(tasksRoot)) {
      return {
        datasetDir: this.datasetDir,
        datasetValid: false,
        datasetError: `Directory "${tasksRoot}" does not exist. Point datasetDir to the OfficeBench repository root.`,
        taskCount: 0,
        runsDir: this.runsDir,
        capabilities,
      }
    }
    const tasks = await this.loadTaskMap()
    return {
      datasetDir: this.datasetDir,
      datasetValid: true,
      taskCount: tasks.size,
      runsDir: this.runsDir,
      capabilities,
    }
  }

  private async loadTaskMap(): Promise<Map<string, OfficeBenchTaskDetail>> {
    if (this.taskCache !== undefined) return this.taskCache
    const map = new Map<string, OfficeBenchTaskDetail>()
    if (this.datasetDir === '') return map
    const tasksRoot = join(this.datasetDir, 'tasks')
    if (!existsSync(tasksRoot)) return map

    const taskDirs = await readdir(tasksRoot, { withFileTypes: true })
    const collected: OfficeBenchTaskDetail[] = []

    for (const dirEntry of taskDirs) {
      if (!dirEntry.isDirectory()) continue
      const taskId = dirEntry.name
      const parsedParts = parseTaskIdParts(taskId)
      const appCount = parsedParts?.[0] ?? 1
      const taskDir = join(tasksRoot, taskId)
      const subtasksDir = join(taskDir, 'subtasks')
      if (!existsSync(subtasksDir)) continue

      const initialFiles = await listTestbedFiles(join(taskDir, 'testbed'))
      const subtaskFiles = (await readdir(subtasksDir)).filter(name => name.endsWith('.json'))

      for (const fileName of subtaskFiles) {
        const subtaskId = fileName.slice(0, -'.json'.length)
        const jsonPath = join(subtasksDir, fileName)
        let parsed: OfficeBenchSubtaskJson
        try {
          parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as OfficeBenchSubtaskJson
        } catch (_error: unknown) {
          continue
        }
        const key = `${taskId}/${subtaskId}`
        const appTags = inferAppTags(parsed, initialFiles)
        collected.push({
          key,
          taskId,
          subtaskId,
          appCount,
          task: parsed.task,
          username: parsed.username,
          date: parsed.date,
          weekday: parsed.weekday,
          time: parsed.time,
          evaluationCount: Array.isArray(parsed.evaluation) ? parsed.evaluation.length : 0,
          appTags,
          fileCount: initialFiles.length,
          evaluation: Array.isArray(parsed.evaluation) ? parsed.evaluation : [],
          initialFiles,
        })
      }
    }

    collected.sort(compareTasks)
    for (const item of collected) {
      map.set(item.key, item)
    }
    this.taskCache = map
    return map
  }

  /** List OfficeBench subtasks with optional search, app-count, and app-tag filtering. */
  async listTasks(filters: {
    readonly search?: string
    readonly appCount?: number
    readonly appTag?: OfficeBenchAppTag
  } = {}): Promise<{ readonly status: OfficeBenchStatus; readonly tasks: readonly OfficeBenchTaskSummary[] }> {
    const status = await this.getStatus()
    if (!status.datasetValid) return { status, tasks: [] }
    const map = await this.loadTaskMap()
    const query = filters.search?.trim().toLowerCase() ?? ''
    const summaries: OfficeBenchTaskSummary[] = []

    for (const detail of map.values()) {
      if (filters.appCount !== undefined && detail.appCount !== filters.appCount) continue
      if (filters.appTag !== undefined && !detail.appTags.includes(filters.appTag)) continue
      if (query !== '') {
        const haystack = `${detail.key} ${detail.task} ${detail.username} ${detail.appTags.join(' ')}`.toLowerCase()
        if (!haystack.includes(query)) continue
      }
      const { evaluation: _eval, initialFiles: _files, ...summary } = detail
      summaries.push(summary)
    }
    return { status, tasks: summaries }
  }

  /** Read full metadata and evaluation criteria for one task key (`<taskId>/<subtaskId>`). */
  async getTask(taskKey: string): Promise<OfficeBenchTaskDetail> {
    const map = await this.loadTaskMap()
    const detail = map.get(taskKey)
    if (detail === undefined) {
      throw new OfficeBenchError(
        `OfficeBench task "${taskKey}" was not found in dataset "${this.datasetDir}"`,
        'OFFICEBENCH_TASK_NOT_FOUND',
      )
    }
    return detail
  }

  private runMetaPath(runId: string): string {
    return join(this.runsDir, runId, RUNS_META_FILENAME)
  }

  private async readRunMeta(runId: string): Promise<PersistedRunMeta | undefined> {
    const metaPath = this.runMetaPath(runId)
    if (!existsSync(metaPath)) return undefined
    try {
      return JSON.parse(await readFile(metaPath, 'utf8')) as PersistedRunMeta
    } catch (_error: unknown) {
      return undefined
    }
  }

  private async writeRunMeta(meta: PersistedRunMeta): Promise<void> {
    const dir = join(this.runsDir, meta.record.runId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, RUNS_META_FILENAME), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  }

  /** List all persisted debug runs, newest first. */
  async listRuns(): Promise<OfficeBenchRunRecord[]> {
    if (!existsSync(this.runsDir)) return []
    const entries = await readdir(this.runsDir, { withFileTypes: true })
    const runs: OfficeBenchRunRecord[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await this.readRunMeta(entry.name)
      if (meta !== undefined) runs.push(meta.record)
    }
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return runs
  }

  /** Create a fresh isolated run directory containing a clean copy of the task's `testbed/`. */
  async createRun(taskKey: string, sessionId?: string): Promise<CreateRunResponse> {
    const task = await this.getTask(taskKey)
    const slug = `${task.taskId}-s${task.subtaskId}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const runDir = join(this.runsDir, slug)
    const testbedDir = join(runDir, 'testbed')
    const sourceTestbed = join(this.datasetDir, 'tasks', task.taskId, 'testbed')

    await mkdir(testbedDir, { recursive: true })
    if (existsSync(sourceTestbed)) {
      await cp(sourceTestbed, testbedDir, { recursive: true })
    }
    // Match OfficeAgentEnv._prepare_docker_testbed ensuring data/emails/calendar exist.
    await mkdir(join(testbedDir, 'data'), { recursive: true })
    await mkdir(join(testbedDir, 'emails'), { recursive: true })
    await mkdir(join(testbedDir, 'calendar'), { recursive: true })

    const initialHashes = await computeFileHashes(testbedDir)
    const record: OfficeBenchRunRecord = {
      runId: slug,
      taskKey: task.key,
      taskId: task.taskId,
      subtaskId: task.subtaskId,
      task: task.task,
      username: task.username,
      date: task.date,
      weekday: task.weekday,
      time: task.time,
      datasetDir: this.datasetDir,
      runDir,
      testbedDir,
      createdAt: new Date().toISOString(),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
    await this.writeRunMeta({ record, initialHashes })

    return {
      run: record,
      task,
      suggestedPrompt: buildSuggestedTaskPrompt(task),
    }
  }

  /** Bind a DSH Session ID to an existing OfficeBench run record. */
  async bindSession(runId: string, sessionId: string): Promise<OfficeBenchRunRecord> {
    const meta = await this.readRunMeta(runId)
    if (meta === undefined) {
      throw new OfficeBenchError(`OfficeBench run "${runId}" not found`, 'OFFICEBENCH_RUN_NOT_FOUND')
    }
    const updated: OfficeBenchRunRecord = { ...meta.record, sessionId }
    await this.writeRunMeta({ ...meta, record: updated })
    return updated
  }

  /** Locate the OfficeBench run associated with a DSH session ID or working directory (`cwd`). */
  async findRunForSession(sessionId?: string, cwd?: string): Promise<OfficeBenchRunRecord | undefined> {
    const runs = await this.listRuns()
    if (sessionId !== undefined && sessionId !== '') {
      const bySession = runs.find(run => run.sessionId === sessionId)
      if (bySession !== undefined) return bySession
    }
    if (cwd !== undefined && cwd !== '') {
      const target = normalizePathKey(cwd)
      const byCwd = runs.find(run => normalizePathKey(run.testbedDir) === target)
      if (byCwd !== undefined) return byCwd
    }
    return undefined
  }

  /** Synchronously check whether `cwd` sits inside a known OfficeBench run by reading its adjacent `run.json`. */
  async findRunByTestbedCwd(cwd: string): Promise<OfficeBenchRunRecord | undefined> {
    const parentMeta = join(resolve(cwd), '..', RUNS_META_FILENAME)
    if (existsSync(parentMeta)) {
      try {
        const meta = JSON.parse(await readFile(parentMeta, 'utf8')) as PersistedRunMeta
        if (normalizePathKey(meta.record.testbedDir) === normalizePathKey(cwd)) {
          return meta.record
        }
      } catch (_error: unknown) {
        // Ignore non-OfficeBench parent files.
      }
    }
    return await this.findRunForSession(undefined, cwd)
  }

  /** Build a complete structured overview of a run's live testbed (files, diff, emails, calendar, answer.txt). */
  async inspectRun(runId: string): Promise<SessionRunContextResponse> {
    const meta = await this.readRunMeta(runId)
    if (meta === undefined) {
      throw new OfficeBenchError(`OfficeBench run "${runId}" not found`, 'OFFICEBENCH_RUN_NOT_FOUND')
    }
    const { record, initialHashes } = meta
    const overview = await this.buildTestbedOverview(record, initialHashes)
    let task: OfficeBenchTaskDetail | null = null
    try {
      task = await this.readTaskFromRecord(record)
    } catch (_error: unknown) {
      task = null
    }
    return { run: record, task, overview }
  }

  /** Inspect the active OfficeBench run for a given DSH session ID / workspace cwd. */
  async inspectSession(sessionId: string, cwd?: string): Promise<SessionRunContextResponse> {
    const record = await this.findRunForSession(sessionId, cwd)
    if (record === undefined) {
      return { run: null, task: null, overview: null }
    }
    return await this.inspectRun(record.runId)
  }

  private async readTaskFromRecord(record: OfficeBenchRunRecord): Promise<OfficeBenchTaskDetail> {
    const subtaskPath = join(record.datasetDir, 'tasks', record.taskId, 'subtasks', `${record.subtaskId}.json`)
    const parsed = JSON.parse(await readFile(subtaskPath, 'utf8')) as OfficeBenchSubtaskJson
    const initialFiles = await listTestbedFiles(join(record.datasetDir, 'tasks', record.taskId, 'testbed'))
    const parts = parseTaskIdParts(record.taskId)
    return {
      key: record.taskKey,
      taskId: record.taskId,
      subtaskId: record.subtaskId,
      appCount: parts?.[0] ?? 1,
      task: parsed.task,
      username: parsed.username,
      date: parsed.date,
      weekday: parsed.weekday,
      time: parsed.time,
      evaluationCount: Array.isArray(parsed.evaluation) ? parsed.evaluation.length : 0,
      appTags: inferAppTags(parsed, initialFiles),
      fileCount: initialFiles.length,
      evaluation: Array.isArray(parsed.evaluation) ? parsed.evaluation : [],
      initialFiles,
    }
  }

  private async buildTestbedOverview(
    record: OfficeBenchRunRecord,
    initialHashes: Record<string, string>,
  ): Promise<TestbedOverview> {
    const files = await listTestbedFiles(record.testbedDir)
    const currentHashes = await computeFileHashes(record.testbedDir)

    const changes: TestbedFileChange[] = []
    for (const file of files) {
      const before = initialHashes[file.relativePath]
      const after = currentHashes[file.relativePath]
      if (before === undefined) {
        changes.push({ relativePath: file.relativePath, status: 'added', sizeBytes: file.sizeBytes })
      } else if (before !== after) {
        changes.push({ relativePath: file.relativePath, status: 'modified', sizeBytes: file.sizeBytes })
      }
    }
    for (const prevPath of Object.keys(initialHashes)) {
      if (currentHashes[prevPath] === undefined) {
        changes.push({ relativePath: prevPath, status: 'deleted' })
      }
    }

    const emails: TestbedEmailSummary[] = []
    const calendarEvents: TestbedCalendarEvent[] = []
    for (const file of files) {
      const fullPath = join(record.testbedDir, file.relativePath)
      if (file.category === 'emails' && file.extension === '.eml') {
        const parts = file.relativePath.split('/')
        const account = parts[1] ?? 'unknown'
        const emailId = parts[parts.length - 1] ?? file.relativePath
        try {
          const parsed = await parseEmlFileHost(fullPath, emailId, -1)
          emails.push({
            account,
            emailId: parsed.email_id,
            relativePath: file.relativePath,
            from: parsed.from,
            to: parsed.to,
            subject: parsed.subject,
            content: parsed.content,
          })
        } catch (_error: unknown) {
          // Skip malformed email file in overview without crashing inspector.
        }
      } else if (file.category === 'calendar' && file.extension === '.ics') {
        const fileName = file.relativePath.split('/').pop() ?? ''
        const username = fileName.endsWith('.ics') ? fileName.slice(0, -4) : fileName
        try {
          const events = await readCalendarFileHost(fullPath)
          for (const event of events) {
            calendarEvents.push({
              username,
              relativePath: file.relativePath,
              summary: event.summary,
              timeStart: event.time_start,
              timeEnd: event.time_end,
              description: event.description,
              location: event.location,
            })
          }
        } catch (_error: unknown) {
          // Skip malformed calendar file in overview.
        }
      }
    }

    const answerPath = join(record.testbedDir, 'data', 'answer.txt')
    let answerText: string | null = null
    if (existsSync(answerPath)) {
      try {
        answerText = await readFile(answerPath, 'utf8')
      } catch (_error: unknown) {
        answerText = null
      }
    }

    return {
      runId: record.runId,
      testbedDir: record.testbedDir,
      files,
      changes,
      emails,
      calendarEvents,
      answerText,
    }
  }

  /** Run all OfficeBench evaluation rules for a run and persist the latest report. */
  async evaluateRun(runId: string): Promise<{ readonly report: EvaluationReport; readonly run: OfficeBenchRunRecord }> {
    const meta = await this.readRunMeta(runId)
    if (meta === undefined) {
      throw new OfficeBenchError(`OfficeBench run "${runId}" not found`, 'OFFICEBENCH_RUN_NOT_FOUND')
    }
    const task = await this.readTaskFromRecord(meta.record)
    const taskSourceDir = join(meta.record.datasetDir, 'tasks', meta.record.taskId)
    const report = await evaluateTaskRules(
      {
        runId: meta.record.runId,
        taskKey: meta.record.taskKey,
        testbedDir: meta.record.testbedDir,
        initialTestbedDir: join(taskSourceDir, 'testbed'),
        taskSourceDir,
      },
      task.evaluation,
    )
    const updated: OfficeBenchRunRecord = {
      ...meta.record,
      lastEvaluation: report,
    }
    await this.writeRunMeta({ ...meta, record: updated })
    return { report, run: updated }
  }

  /** Reset a run's `testbed/` directory back to its pristine initial task state. */
  async resetRun(runId: string): Promise<SessionRunContextResponse> {
    const meta = await this.readRunMeta(runId)
    if (meta === undefined) {
      throw new OfficeBenchError(`OfficeBench run "${runId}" not found`, 'OFFICEBENCH_RUN_NOT_FOUND')
    }
    const { record } = meta
    const sourceTestbed = join(record.datasetDir, 'tasks', record.taskId, 'testbed')
    await rm(record.testbedDir, { recursive: true, force: true })
    await mkdir(record.testbedDir, { recursive: true })
    if (existsSync(sourceTestbed)) {
      await cp(sourceTestbed, record.testbedDir, { recursive: true })
    }
    await mkdir(join(record.testbedDir, 'data'), { recursive: true })
    await mkdir(join(record.testbedDir, 'emails'), { recursive: true })
    await mkdir(join(record.testbedDir, 'calendar'), { recursive: true })

    const initialHashes = await computeFileHashes(record.testbedDir)
    const { lastEvaluation: _cleared, ...rest } = record
    const updated: OfficeBenchRunRecord = rest
    await this.writeRunMeta({ record: updated, initialHashes })
    return await this.inspectRun(runId)
  }

  /** Permanently delete a stored run directory. */
  async deleteRun(runId: string): Promise<boolean> {
    const dir = join(this.runsDir, runId)
    if (!existsSync(dir)) return false
    await rm(dir, { recursive: true, force: true })
    return true
  }
}

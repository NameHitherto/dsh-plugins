/**
 * Shared types for the OfficeBench host service, tools, evaluator, and Web UI client.
 * Zero Node.js imports so both Host and Browser builds import directly from this module.
 *
 * @module dsh-officebench-plugin/types
 */

/** Raw plugin configuration accepted from `cordis.yml` / `cordis.patch.yml`. */
export interface OfficeBenchConfig {
  /** Path to the OfficeBench repository root (containing `tasks/`). Empty string allows setting it in Web UI or via `OFFICEBENCH_DIR`. */
  datasetDir?: string
  /** Directory where isolated per-run OfficeBench testbed copies and metadata are stored. */
  runsDir?: string
  /** Timeout in milliseconds for `shell_command` executions (default 30000). */
  shellTimeoutMs?: number
  /** OCR language code passed to Tesseract (default `eng`). */
  ocrLanguage?: string
  /** Optional path to the LibreOffice (`soffice`) binary; auto-detected when omitted. */
  libreOfficePath?: string
  /** Optional path to the Tesseract CLI binary; auto-detected when omitted. */
  tesseractPath?: string
  /** Optional path to a Python executable (used for PDF->image rendering if PyMuPDF is available). */
  pythonPath?: string
  /** When true, also register OfficeBench tools globally on the root Host scope (useful for headless/non-preset profiles). */
  registerToolsGlobally?: boolean
}

/** Validated, normalized plugin configuration. */
export interface ResolvedOfficeBenchConfig {
  readonly datasetDir: string
  readonly runsDir: string
  readonly shellTimeoutMs: number
  readonly ocrLanguage: string
  readonly libreOfficePath?: string
  readonly tesseractPath?: string
  readonly pythonPath?: string
  readonly registerToolsGlobally: boolean
}

/** One evaluation specification entry as stored in `tasks/<taskId>/subtasks/<subtaskId>.json`. */
export interface OfficeBenchEvaluationRule {
  readonly function: string
  readonly args: Record<string, unknown>
}

/** Raw JSON schema of an OfficeBench subtask file. */
export interface OfficeBenchSubtaskJson {
  readonly username: string
  readonly date: string
  readonly weekday: string
  readonly time: string
  readonly task: string
  readonly evaluation: readonly OfficeBenchEvaluationRule[]
}

/** App category inferred from a task's files, prompt, and evaluation rules. */
export type OfficeBenchAppTag =
  | 'excel'
  | 'word'
  | 'pdf'
  | 'ocr'
  | 'email'
  | 'calendar'
  | 'shell'

/** Compact catalog entry for one OfficeBench subtask. */
export interface OfficeBenchTaskSummary {
  /** Composite key `<taskId>/<subtaskId>`, e.g. `1-10/0`. */
  readonly key: string
  /** Task folder name, e.g. `1-10`, `2-26`, `3-42`. */
  readonly taskId: string
  /** Subtask identifier, e.g. `0`, `1`. */
  readonly subtaskId: string
  /** Number of apps category from the prefix (`1`, `2`, or `3`). */
  readonly appCount: number
  /** Task prompt text. */
  readonly task: string
  /** Virtual user name (e.g. `Alice`, `Bob`). */
  readonly username: string
  /** Virtual date string (e.g. `2020-05-01`). */
  readonly date: string
  /** Virtual weekday string (e.g. `Friday`). */
  readonly weekday: string
  /** Virtual clock time string (e.g. `10:00 AM`). */
  readonly time: string
  /** Count of evaluation criteria in this subtask. */
  readonly evaluationCount: number
  /** Inferred app tags for filtering. */
  readonly appTags: readonly OfficeBenchAppTag[]
  /** Number of files initially present in `testbed/`. */
  readonly fileCount: number
}

/** One file entry inside a task or run testbed. */
export interface TestbedFileEntry {
  /** POSIX path relative to `testbed/`, e.g. `data/salary.xlsx`. */
  readonly relativePath: string
  /** Top-level category (`data`, `emails`, `calendar`, or `other`). */
  readonly category: 'data' | 'emails' | 'calendar' | 'other'
  /** File size in bytes. */
  readonly sizeBytes: number
  /** Lowercase extension including dot (e.g. `.xlsx`), or empty string. */
  readonly extension: string
}

/** Detailed view of one OfficeBench subtask before or during execution. */
export interface OfficeBenchTaskDetail extends OfficeBenchTaskSummary {
  readonly evaluation: readonly OfficeBenchEvaluationRule[]
  readonly initialFiles: readonly TestbedFileEntry[]
}

/** Outcome of evaluating one single OfficeBench criterion. */
export interface EvaluationRuleResult {
  readonly index: number
  readonly function: string
  readonly args: Record<string, unknown>
  readonly passed: boolean
  readonly message: string
}

/** Aggregate evaluation report for a run's current testbed state. */
export interface EvaluationReport {
  readonly runId: string
  readonly taskKey: string
  readonly evaluatedAt: string
  readonly passed: boolean
  readonly passedCount: number
  readonly totalCount: number
  readonly rules: readonly EvaluationRuleResult[]
}

/** File diff status relative to the run's initial testbed snapshot. */
export type TestbedChangeStatus = 'added' | 'modified' | 'deleted'

/** One file difference compared to the initial testbed snapshot. */
export interface TestbedFileChange {
  readonly relativePath: string
  readonly status: TestbedChangeStatus
  readonly sizeBytes?: number
}

/** Parsed email summary for the Web UI Inspector. */
export interface TestbedEmailSummary {
  readonly account: string
  readonly emailId: string
  readonly relativePath: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly content: string
}

/** Parsed calendar event summary for the Web UI Inspector. */
export interface TestbedCalendarEvent {
  readonly username: string
  readonly relativePath: string
  readonly summary: string
  readonly timeStart: string
  readonly timeEnd: string
  readonly description: string
  readonly location: string
}

/** Complete structured overview of a run's live testbed state. */
export interface TestbedOverview {
  readonly runId: string
  readonly testbedDir: string
  readonly files: readonly TestbedFileEntry[]
  readonly changes: readonly TestbedFileChange[]
  readonly emails: readonly TestbedEmailSummary[]
  readonly calendarEvents: readonly TestbedCalendarEvent[]
  readonly answerText: string | null
}

/** Persistent metadata record for an isolated OfficeBench debug run. */
export interface OfficeBenchRunRecord {
  readonly runId: string
  readonly taskKey: string
  readonly taskId: string
  readonly subtaskId: string
  readonly task: string
  readonly username: string
  readonly date: string
  readonly weekday: string
  readonly time: string
  readonly datasetDir: string
  readonly runDir: string
  readonly testbedDir: string
  readonly createdAt: string
  readonly sessionId?: string
  readonly lastEvaluation?: EvaluationReport
}

/** Dataset status returned by the Host service. */
export interface OfficeBenchStatus {
  readonly datasetDir: string
  readonly datasetValid: boolean
  readonly datasetError?: string
  readonly taskCount: number
  readonly runsDir: string
  readonly capabilities: {
    readonly libreOffice: boolean
    readonly tesseractCli: boolean
    readonly pythonPyMuPdf: boolean
  }
}

/** Response from `runs/create` including the recommended user prompt to send to the agent. */
export interface CreateRunResponse {
  readonly run: OfficeBenchRunRecord
  readonly task: OfficeBenchTaskDetail
  readonly suggestedPrompt: string
}

/** Response from inspecting the OfficeBench state of a DSH Session. */
export interface SessionRunContextResponse {
  readonly run: OfficeBenchRunRecord | null
  readonly task: OfficeBenchTaskDetail | null
  readonly overview: TestbedOverview | null
}

/** Named RPC endpoints exposed on the `/officebench` Host channel. */
export interface OfficeBenchRpcMap {
  'status/get': {
    request: Record<string, never>
    response: OfficeBenchStatus
  }
  'config/set-dataset-dir': {
    request: { readonly datasetDir: string }
    response: OfficeBenchStatus
  }
  'tasks/list': {
    request: { readonly search?: string; readonly appCount?: number; readonly appTag?: OfficeBenchAppTag }
    response: { readonly status: OfficeBenchStatus; readonly tasks: readonly OfficeBenchTaskSummary[] }
  }
  'tasks/get': {
    request: { readonly taskKey: string }
    response: { readonly task: OfficeBenchTaskDetail }
  }
  'runs/list': {
    request: Record<string, never>
    response: { readonly runs: readonly OfficeBenchRunRecord[] }
  }
  'runs/create': {
    request: { readonly taskKey: string; readonly sessionId?: string }
    response: CreateRunResponse
  }
  'runs/bind-session': {
    request: { readonly runId: string; readonly sessionId: string }
    response: { readonly run: OfficeBenchRunRecord }
  }
  'runs/for-session': {
    request: { readonly sessionId: string; readonly cwd?: string }
    response: SessionRunContextResponse
  }
  'runs/inspect': {
    request: { readonly runId: string }
    response: SessionRunContextResponse
  }
  'runs/evaluate': {
    request: { readonly runId: string }
    response: { readonly report: EvaluationReport; readonly run: OfficeBenchRunRecord }
  }
  'runs/reset': {
    request: { readonly runId: string }
    response: SessionRunContextResponse
  }
  'runs/delete': {
    request: { readonly runId: string }
    response: { readonly deleted: boolean }
  }
}

export type OfficeBenchRpcEndpoint = keyof OfficeBenchRpcMap

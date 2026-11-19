/**
 * Custom Web UI tool views (`tool.call.toolview`) for OfficeBench tools so
 * nested PTC batch calls inside `run_code` render with clear app badges,
 * concise summaries, clickable file preview links, and collapsible output.
 *
 * @module dsh-officebench-plugin/client/OfficeBenchToolRow
 */

import { useState, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { OfficeBenchLocaleKey } from './locales.ts'

type OfficeBenchToolRowProps = ToolCallViewProps & PropsLocale<'officebench'>

function appBadgeForTool(toolName: string): { readonly label: string; readonly tone: string } {
  if (toolName.startsWith('excel_')) return { label: 'Excel', tone: 'ob-badge-pass' }
  if (toolName.startsWith('word_')) return { label: 'Word', tone: 'ob-badge-accent' }
  if (toolName.startsWith('pdf_') || toolName.startsWith('image_')) return { label: 'PDF', tone: 'ob-badge-fail' }
  if (toolName.startsWith('ocr_')) return { label: 'OCR', tone: 'ob-badge-warn' }
  if (toolName.startsWith('email_')) return { label: 'Email', tone: 'ob-badge-accent' }
  if (toolName.startsWith('calendar_')) return { label: 'Calendar', tone: 'ob-badge-warn' }
  if (toolName === 'shell_command') return { label: 'Shell', tone: '' }
  if (toolName === 'finish_task') return { label: 'Finish', tone: 'ob-badge-pass' }
  return { label: 'Testbed', tone: '' }
}

function extractRawArgs(props: ToolCallViewProps): Record<string, unknown> {
  if (props.phase === 'preparing') return {}
  const argsRaw = props.phase === 'result' ? props.block.call?.argsRaw : props.block.argsRaw
  if (typeof argsRaw !== 'string' || argsRaw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (_error: unknown) {
    // Partial or malformed wire JSON; degrade gracefully to empty summary args.
  }
  return {}
}

function extractResultText(props: ToolCallViewProps): string | null {
  if (props.phase !== 'result') return null
  const content = props.block.content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.length === 0 ? null : parts.join('\n')
}

function primaryFileOf(args: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'pdf_file_path', 'word_file_path', 'excel_file_path', 'image_file_path']) {
    const val = args[key]
    if (typeof val === 'string' && val.trim() !== '') return val.trim()
  }
  return undefined
}

function summarizeCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'excel_set_cell':
      return `set (${String(args.row_idx ?? '?')}, ${String(args.column_idx ?? '?')}) = ${JSON.stringify(args.text ?? '')}`
    case 'excel_delete_cell':
      return `delete (${String(args.row_idx ?? '?')}, ${String(args.column_idx ?? '?')})`
    case 'excel_read_file':
      return args.sheet !== undefined ? `read sheet "${String(args.sheet)}"` : 'read workbook'
    case 'excel_create_new_file':
      return 'create workbook'
    case 'excel_convert_to_pdf':
      return `convert → ${String(args.pdf_file_path ?? '')}`
    case 'word_write_to_file':
      return `write (${String(args.style ?? 'pure-text')}): ${String(args.contents ?? '').slice(0, 60)}`
    case 'word_read_file':
      return 'read document'
    case 'word_create_new_file':
      return 'create document'
    case 'word_convert_to_pdf':
      return `convert → ${String(args.pdf_file_path ?? '')}`
    case 'pdf_read_file':
      return 'extract text'
    case 'pdf_convert_to_word':
      return `convert → ${String(args.word_file_path ?? '')}`
    case 'pdf_convert_to_image':
      return `render → ${String(args.image_file_path ?? '')}`
    case 'image_convert_to_pdf':
      return `convert → ${String(args.pdf_file_path ?? '')}`
    case 'ocr_recognize_file':
      return 'recognize text'
    case 'email_list_emails':
      return `list mailbox (${String(args.username ?? '')})`
    case 'email_read_email':
      return `read ${String(args.username ?? '')}/${String(args.email_id ?? '')}`
    case 'email_send_email':
      return `${String(args.sender ?? '')} → ${String(args.recipient ?? '')}: "${String(args.subject ?? '')}"`
    case 'calendar_list_events':
      return `list events (${String(args.username ?? '')})`
    case 'calendar_create_event':
      return `${String(args.user ?? '')}: "${String(args.summary ?? '')}" (${String(args.time_start ?? '')})`
    case 'calendar_delete_event':
      return `${String(args.user ?? '')}: delete "${String(args.summary ?? '')}"`
    case 'shell_command':
      return String(args.command ?? '')
    case 'finish_task':
      return args.answer !== undefined && args.answer !== '' && args.answer !== 'None'
        ? `answer: ${String(args.answer).slice(0, 80)}`
        : 'complete task'
    case 'officebench_list_files':
      return `list ${String(args.directory ?? '/testbed')}`
    case 'officebench_read_text':
      return 'read text'
    default:
      return toolName
  }
}

function normalizeForOpenFile(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\/testbed\/?/, '')
}

export function OfficeBenchToolRow(props: OfficeBenchToolRowProps): ReactElement {
  const { toolName, openFile, t } = props
  const tr = t as (key: OfficeBenchLocaleKey) => string
  const [expanded, setExpanded] = useState(false)

  const badge = appBadgeForTool(toolName)
  const args = extractRawArgs(props)
  const summary = summarizeCall(toolName, args)
  const filePath = primaryFileOf(args)
  const outputText = extractResultText(props)
  const isRunning = props.phase !== 'result'
  const isError = props.phase === 'result' && props.block.isError === true

  return (
    <div className="ob-tool-row" data-officebench-tool={toolName}>
      <div className="ob-tool-head">
        <button
          type="button"
          className="ob-tool-toggle"
          onClick={() => { setExpanded(prev => !prev) }}
          aria-expanded={expanded}
        >
          <span className={`ob-badge ${badge.tone}`}>{badge.label}</span>
          <span className="ob-tool-summary">{summary}</span>
          {isRunning ? <span className="ob-badge">{tr('tool.running')}</span> : null}
          {isError ? <span className="ob-badge ob-badge-fail">{tr('tool.error')}</span> : null}
        </button>
        {filePath !== undefined ? (
          <button
            type="button"
            className="ob-tool-file-btn"
            onClick={() => { openFile(normalizeForOpenFile(filePath)) }}
          >
            {filePath}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="ob-tool-details">
          <div>
            <div className="ob-kv-label">{tr('tool.args')}</div>
            <pre className="ob-tool-pre">{JSON.stringify(args, null, 2)}</pre>
          </div>
          {outputText !== null ? (
            <div>
              <div className="ob-kv-label">{tr('tool.output')}</div>
              <pre className="ob-tool-pre">{outputText}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

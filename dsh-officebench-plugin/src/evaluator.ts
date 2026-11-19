/**
 * Faithful TypeScript implementation of all 9 OfficeBench evaluation functions
 * (`evaluate_contain`, `evaluate_not_contain`, `evaluate_file_exist`,
 * `evaluate_file_not_exist`, `evaluate_diff_contain_text`,
 * `evaluate_excel_cell_value`, `evaluate_excel_cell_comparator`,
 * `evaluate_exact_match`, `evaluate_calendar_no_overlap`).
 *
 * Also handles OfficeBench's legacy relative evaluation paths such as
 * `../../../../reference/<file>` and `../../../../cache/<subtask>/testbed/<file>`.
 *
 * @module dsh-officebench-plugin/evaluator
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readCalendarFileHost, findCalendarOverlaps } from './office/calendar.ts'
import { emailListEmails } from './office/email.ts'
import { readExcelWorkbookHost } from './office/excel.ts'
import { readPdfHost } from './office/pdf.ts'
import { readDocxHost } from './office/word.ts'
import type {
  EvaluationReport,
  EvaluationRuleResult,
  OfficeBenchEvaluationRule,
} from './types.ts'

/** Context paths needed to evaluate one OfficeBench run cleanly. */
export interface EvaluationContext {
  readonly runId: string
  readonly taskKey: string
  readonly testbedDir: string
  /** Optional directory containing the untouched initial testbed (`tasks/<taskId>/testbed`). */
  readonly initialTestbedDir?: string
  /** Optional task directory (`tasks/<taskId>`) containing `reference/` files. */
  readonly taskSourceDir?: string
}

function isNumericString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  return Number.isFinite(Number(trimmed))
}

function evaluateContainText(
  content: string,
  keywords: readonly string[],
): { readonly passed: boolean; readonly missing: readonly string[] } {
  const lowered = content.toLowerCase()
  const missing: string[] = []
  for (const rawKeyword of keywords) {
    const keyword = String(rawKeyword).toLowerCase()
    const haystack = isNumericString(keyword) ? lowered.replaceAll(',', '') : lowered
    if (!haystack.includes(keyword)) {
      missing.push(String(rawKeyword))
    }
  }
  return { passed: missing.length === 0, missing }
}

/**
 * Resolve a path used inside an OfficeBench evaluation rule, handling:
 * - Normal testbed-relative paths (`data/answer.txt`, `./data/score.xlsx`, `calendar/Bob.ics`)
 * - Reference paths (`../../../../reference/sorted_score.xlsx`) -> `<taskSourceDir>/reference/...`
 * - Cached initial testbed paths (`../../../../cache/<subtask>/testbed/data/score.xlsx`) -> `<initialTestbedDir>/...`
 */
export function resolveEvaluationFilePath(
  context: EvaluationContext,
  rawFile: string,
): string {
  const normalized = rawFile.replace(/\\/g, '/')

  const refMatch = /^(?:\.\.\/)+reference\/(.+)$/.exec(normalized)
  if (refMatch !== null && context.taskSourceDir !== undefined) {
    return resolve(context.taskSourceDir, 'reference', refMatch[1]!)
  }

  const cacheMatch = /^(?:\.\.\/)+cache\/[^/]+\/testbed\/(.+)$/.exec(normalized)
  if (cacheMatch !== null && context.initialTestbedDir !== undefined) {
    return resolve(context.initialTestbedDir, cacheMatch[1]!)
  }

  if (normalized.startsWith('/testbed/')) {
    return resolve(context.testbedDir, normalized.slice('/testbed/'.length))
  }
  return resolve(context.testbedDir, normalized)
}

async function readDocumentTextByType(hostPath: string, docType: string): Promise<string> {
  switch (docType) {
    case 'xlsx': {
      const data = await readExcelWorkbookHost(hostPath)
      return data.formatted
    }
    case 'txt':
    case 'ics':
      return await readFile(hostPath, 'utf8')
    case 'doc':
    case 'docx': {
      const data = await readDocxHost(hostPath)
      return data.text
    }
    case 'pdf': {
      const data = await readPdfHost(hostPath)
      return data.text
    }
    default:
      throw new Error(`Unsupported doc_type "${docType}" in OfficeBench evaluation`)
  }
}

/**
 * Safely evaluate simple Python `lambda x: ...` comparators used by
 * `evaluate_excel_cell_comparator` (such as `lambda x: x in ['1', '2', '3', '4', '5']`,
 * numeric comparisons, or `.isdigit()` checks) without invoking `eval`.
 */
export function evaluateSafeComparator(expression: string, value: string): boolean {
  const trimmed = expression.trim()
  const lambdaMatch = /^lambda\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(trimmed)
  const varName = lambdaMatch?.[1] ?? 'x'
  const body = (lambdaMatch?.[2] ?? trimmed).trim()

  // Pattern 1: `<var> in [...]`
  const inListMatch = new RegExp(`^${varName}\\s+in\\s+\\[(.*)\\]$`).exec(body)
  if (inListMatch !== null) {
    const rawItems = inListMatch[1]!.split(',').map(part => part.trim()).filter(Boolean)
    const items = rawItems.map(item => {
      if ((item.startsWith("'") && item.endsWith("'")) || (item.startsWith('"') && item.endsWith('"'))) {
        return item.slice(1, -1)
      }
      return item
    })
    return items.includes(value)
  }

  // Pattern 2: `int(<var>) <op> <num>` or `float(<var>) <op> <num>`
  const numCmpMatch = new RegExp(`^(?:int|float)\\(${varName}\\)\\s*(==|!=|<=|>=|<|>)\\s*(-?\\d+(?:\\.\\d+)?)$`).exec(body)
  if (numCmpMatch !== null) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return false
    const rhs = Number(numCmpMatch[2])
    switch (numCmpMatch[1]) {
      case '==': return parsed === rhs
      case '!=': return parsed !== rhs
      case '<=': return parsed <= rhs
      case '>=': return parsed >= rhs
      case '<': return parsed < rhs
      case '>': return parsed > rhs
    }
  }

  // Pattern 3: `<var> == '...'` or `<var> != '...'`
  const eqMatch = new RegExp(`^${varName}\\s*(==|!=)\\s*['"](.*)['"]$`).exec(body)
  if (eqMatch !== null) {
    return eqMatch[1] === '==' ? value === eqMatch[2] : value !== eqMatch[2]
  }

  // Pattern 4: `<var>.isdigit()` (optionally combined with `and int(<var>) == N`)
  const digitAndMatch = new RegExp(`^${varName}\\.isdigit\\(\\)\\s*(?:==\\s*True)?(?:\\s+and\\s+(.+))?$`).exec(body)
  if (digitAndMatch !== null) {
    if (!/^\d+$/.test(value)) return false
    if (digitAndMatch[1] === undefined) return true
    return evaluateSafeComparator(`lambda ${varName}: ${digitAndMatch[1]}`, value)
  }

  throw new Error(`Unsupported comparator expression: "${expression}"`)
}

function diffLinesChanged(inputContent: string, outputContent: string): string {
  const oldLines = inputContent.split('\n')
  const newLines = outputContent.split('\n')
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  const diffChunks: string[] = []
  for (const line of oldLines) {
    if (!newSet.has(line)) diffChunks.push(`-${line}`)
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) diffChunks.push(`+${line}`)
  }
  return diffChunks.join('\n')
}

async function evaluateContainRule(
  context: EvaluationContext,
  args: Record<string, unknown>,
  negate: boolean,
): Promise<{ readonly passed: boolean; readonly message: string }> {
  const docType = String(args.doc_type ?? '')
  const keywords = Array.isArray(args.keywords) ? args.keywords.map(item => String(item)) : []

  let content: string
  let targetLabel: string

  if (docType === 'email') {
    const username = String(args.username ?? '')
    targetLabel = `emails/${username}`
    const listed = await emailListEmails(context.testbedDir, username, -1)
    content = listed.formatted === 'No emails found.' ? '' : listed.formatted
  } else {
    const fileArg = String(args.file ?? '')
    targetLabel = fileArg
    const hostPath = resolveEvaluationFilePath(context, fileArg)
    if (!existsSync(hostPath) || !statSync(hostPath).isFile()) {
      const passed = negate
      return {
        passed,
        message: passed
          ? `File "${fileArg}" does not exist (negated check passed)`
          : `File not found: ${fileArg}`,
      }
    }
    content = await readDocumentTextByType(hostPath, docType)
  }

  const check = evaluateContainText(content, keywords)
  if (!negate) {
    return check.passed
      ? { passed: true, message: `All ${keywords.length} keyword(s) found in ${targetLabel}` }
      : { passed: false, message: `Missing keyword(s) in ${targetLabel}: ${check.missing.join(', ')}` }
  }
  // Negated (`evaluate_not_contain`): upstream returns `not evaluate_contain(...)`
  const passed = !check.passed
  return passed
    ? { passed: true, message: `Forbidden keyword set not present in ${targetLabel}` }
    : { passed: false, message: `Forbidden keyword(s) unexpectedly found in ${targetLabel}: ${keywords.join(', ')}` }
}

async function evaluateSingleRule(
  context: EvaluationContext,
  rule: OfficeBenchEvaluationRule,
  index: number,
): Promise<EvaluationRuleResult> {
  const args = rule.args
  try {
    switch (rule.function) {
      case 'evaluate_contain': {
        const res = await evaluateContainRule(context, args, false)
        return { index, function: rule.function, args, passed: res.passed, message: res.message }
      }
      case 'evaluate_not_contain': {
        const res = await evaluateContainRule(context, args, true)
        return { index, function: rule.function, args, passed: res.passed, message: res.message }
      }
      case 'evaluate_file_exist': {
        const fileArg = String(args.file ?? '')
        const hostPath = resolveEvaluationFilePath(context, fileArg)
        const exists = existsSync(hostPath)
        return {
          index,
          function: rule.function,
          args,
          passed: exists,
          message: exists ? `File exists: ${fileArg}` : `Missing file: ${fileArg}`,
        }
      }
      case 'evaluate_file_not_exist': {
        const fileArg = String(args.file ?? '')
        const hostPath = resolveEvaluationFilePath(context, fileArg)
        const exists = existsSync(hostPath)
        return {
          index,
          function: rule.function,
          args,
          passed: !exists,
          message: !exists ? `Confirmed absent: ${fileArg}` : `File should not exist: ${fileArg}`,
        }
      }
      case 'evaluate_diff_contain_text': {
        const docType = String(args.doc_type ?? '')
        const inputArg = String(args.input_file ?? '')
        const outputArg = String(args.output_file ?? '')
        const keywords = Array.isArray(args.keywords) ? args.keywords.map(item => String(item)) : []
        const inputPath = resolveEvaluationFilePath(context, inputArg)
        const outputPath = resolveEvaluationFilePath(context, outputArg)
        if (!existsSync(inputPath)) {
          return { index, function: rule.function, args, passed: false, message: `Baseline input file missing: ${inputArg}` }
        }
        if (!existsSync(outputPath)) {
          return { index, function: rule.function, args, passed: false, message: `Output file missing: ${outputArg}` }
        }
        const inputContent = await readDocumentTextByType(inputPath, docType)
        const outputContent = await readDocumentTextByType(outputPath, docType)
        if (inputContent === outputContent) {
          return { index, function: rule.function, args, passed: false, message: `No changes detected in ${outputArg}` }
        }
        const diffText = diffLinesChanged(inputContent, outputContent)
        const missing = keywords.filter(kw => !diffText.includes(kw))
        return {
          index,
          function: rule.function,
          args,
          passed: missing.length === 0,
          message: missing.length === 0
            ? `All ${keywords.length} keyword(s) found in diff of ${outputArg}`
            : `Diff of ${outputArg} missing keyword(s): ${missing.join(', ')}`,
        }
      }
      case 'evaluate_excel_cell_value': {
        const fileArg = String(args.file ?? '')
        const hostPath = resolveEvaluationFilePath(context, fileArg)
        if (!existsSync(hostPath)) {
          return { index, function: rule.function, args, passed: false, message: `Excel file missing: ${fileArg}` }
        }
        const wb = await readExcelWorkbookHost(hostPath)
        const matches = Array.isArray(args.matches) ? args.matches as { row: number | string; col: number | string; value: unknown }[] : []
        const failures: string[] = []
        for (const match of matches) {
          const row = Number(match.row)
          const col = Number(match.col)
          const expected = String(match.value)
          const pattern = `(${row}, ${col}): ${expected}`
          if (!wb.formatted.includes(pattern)) {
            const actualCell = wb.rows[row - 1]?.[col - 1]
            failures.push(`(${row},${col}) expected "${expected}", got ${actualCell === undefined || actualCell === null ? '[Empty]' : JSON.stringify(actualCell)}`)
          }
        }
        return {
          index,
          function: rule.function,
          args,
          passed: failures.length === 0,
          message: failures.length === 0
            ? `All ${matches.length} Excel cell(s) matched in ${fileArg}`
            : failures.join('; '),
        }
      }
      case 'evaluate_excel_cell_comparator': {
        const fileArg = String(args.file ?? '')
        const hostPath = resolveEvaluationFilePath(context, fileArg)
        if (!existsSync(hostPath)) {
          return { index, function: rule.function, args, passed: false, message: `Excel file missing: ${fileArg}` }
        }
        const wb = await readExcelWorkbookHost(hostPath)
        const matches = Array.isArray(args.matches)
          ? args.matches as { row: number | string; col: number | string; comparator: string }[]
          : []
        const failures: string[] = []
        for (const match of matches) {
          const row = Number(match.row)
          const col = Number(match.col)
          const cellVal = wb.rows[row - 1]?.[col - 1]
          const strVal = cellVal === undefined || cellVal === null ? '' : String(cellVal)
          if (strVal === '' || !evaluateSafeComparator(match.comparator, strVal)) {
            failures.push(`(${row},${col}) value "${strVal}" failed comparator "${match.comparator}"`)
          }
        }
        return {
          index,
          function: rule.function,
          args,
          passed: failures.length === 0,
          message: failures.length === 0
            ? `All ${matches.length} Excel cell comparator(s) passed in ${fileArg}`
            : failures.join('; '),
        }
      }
      case 'evaluate_exact_match': {
        const docType = String(args.doc_type ?? '')
        const resultArg = String(args.result_file ?? '')
        const expectedArg = String(args.expected_file ?? '')
        const resultPath = resolveEvaluationFilePath(context, resultArg)
        const expectedPath = resolveEvaluationFilePath(context, expectedArg)
        if (!existsSync(resultPath)) {
          return { index, function: rule.function, args, passed: false, message: `Result file missing: ${resultArg}` }
        }
        if (!existsSync(expectedPath)) {
          return { index, function: rule.function, args, passed: false, message: `Expected reference file missing: ${expectedArg}` }
        }
        if (docType === 'xlsx') {
          const resultWb = await readExcelWorkbookHost(resultPath)
          const expectedWb = await readExcelWorkbookHost(expectedPath)
          const maxRows = Math.max(resultWb.rowCount, expectedWb.rowCount)
          const maxCols = Math.max(resultWb.columnCount, expectedWb.columnCount)
          for (let r = 0; r < maxRows; r++) {
            for (let c = 0; c < maxCols; c++) {
              const actual = resultWb.rows[r]?.[c] ?? null
              const expected = expectedWb.rows[r]?.[c] ?? null
              const equal = actual === expected
                || (actual !== null && expected !== null && String(actual) === String(expected))
              if (!equal) {
                return {
                  index,
                  function: rule.function,
                  args,
                  passed: false,
                  message: `Mismatch at (${r + 1}, ${c + 1}) in ${resultArg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
                }
              }
            }
          }
          return {
            index,
            function: rule.function,
            args,
            passed: true,
            message: `Workbook ${resultArg} matches reference (${expectedWb.rowCount}x${expectedWb.columnCount})`,
          }
        }
        const actualText = await readDocumentTextByType(resultPath, docType)
        const expectedText = await readDocumentTextByType(expectedPath, docType)
        const matched = actualText.trim() === expectedText.trim()
        return {
          index,
          function: rule.function,
          args,
          passed: matched,
          message: matched
            ? `Document ${resultArg} matches expected content`
            : `Document ${resultArg} content does not match reference`,
        }
      }
      case 'evaluate_calendar_no_overlap': {
        const username = String(args.username ?? '')
        const calendarPath = join(context.testbedDir, 'calendar', `${username}.ics`)
        if (!existsSync(calendarPath)) {
          return { index, function: rule.function, args, passed: false, message: `Calendar file missing for ${username}` }
        }
        const events = await readCalendarFileHost(calendarPath)
        const overlaps = findCalendarOverlaps(events)
        if (overlaps.length > 0) {
          const first = overlaps[0]!
          return {
            index,
            function: rule.function,
            args,
            passed: false,
            message: `Overlap in ${username}'s calendar: "${first.first.summary}" (${first.first.time_start}–${first.first.time_end}) overlaps "${first.second.summary}" (${first.second.time_start}–${first.second.time_end})`,
          }
        }
        return {
          index,
          function: rule.function,
          args,
          passed: true,
          message: `No overlapping events in ${username}'s calendar (${events.length} event(s))`,
        }
      }
      default:
        return {
          index,
          function: rule.function,
          args,
          passed: false,
          message: `Unknown OfficeBench evaluation function "${rule.function}"`,
        }
    }
  } catch (error: unknown) {
    return {
      index,
      function: rule.function,
      args,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Evaluate all OfficeBench criteria for a run's current testbed state.
 *
 * @param context - Testbed, baseline, and reference path context.
 * @param rules - Evaluation rules from `tasks/<taskId>/subtasks/<subtaskId>.json`.
 * @returns Full per-rule and aggregate evaluation report.
 */
export async function evaluateTaskRules(
  context: EvaluationContext,
  rules: readonly OfficeBenchEvaluationRule[],
): Promise<EvaluationReport> {
  const results: EvaluationRuleResult[] = []
  for (let i = 0; i < rules.length; i++) {
    results.push(await evaluateSingleRule(context, rules[i]!, i))
  }
  const passedCount = results.filter(item => item.passed).length
  return {
    runId: context.runId,
    taskKey: context.taskKey,
    evaluatedAt: new Date().toISOString(),
    passed: results.length > 0 && passedCount === results.length,
    passedCount,
    totalCount: results.length,
    rules: results,
  }
}

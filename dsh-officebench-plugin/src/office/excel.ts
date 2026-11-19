/**
 * Excel (`.xlsx`) office operations backed by `exceljs`, faithful to OfficeBench's
 * 1-based `(row, col)` indexing, formatted table output, and PDF conversion.
 *
 * @module dsh-officebench-plugin/office/excel
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { OfficeBenchError, resolveTestbedPath } from '../path-resolver.ts'

const execFileAsync = promisify(execFile)

/** JSON-safe primitive value stored in a spreadsheet cell. */
export type ExcelCellScalar = string | number | boolean | null

/** Result of reading an Excel worksheet. */
export interface ExcelReadResult {
  readonly file_path: string
  readonly sheet_name: string
  readonly sheets: readonly string[]
  readonly row_count: number
  readonly column_count: number
  readonly rows: readonly (readonly ExcelCellScalar[])[]
  readonly formatted: string
}

/** Result of writing or deleting an Excel cell. */
export interface ExcelMutateCellResult {
  readonly ok: true
  readonly file_path: string
  readonly sheet_name: string
  readonly row_idx: number
  readonly column_idx: number
  readonly value: ExcelCellScalar
}

/** Result of creating a new Excel file. */
export interface ExcelCreateResult {
  readonly ok: true
  readonly file_path: string
  readonly already_existed: boolean
}

/** Result of converting an Excel file to PDF. */
export interface ExcelConvertPdfResult {
  readonly ok: true
  readonly excel_file_path: string
  readonly pdf_file_path: string
  readonly engine: 'libreoffice' | 'pdf-lib-fallback'
}

/**
 * Unwrap an `exceljs` CellValue into a canonical scalar value compatible with
 * OfficeBench's `openpyxl` cell reads.
 *
 * @param raw - Raw value from an `exceljs` cell.
 * @returns Normalized scalar value (`string | number | boolean | null`).
 */
export function unwrapExcelCellValue(raw: ExcelJS.CellValue): ExcelCellScalar {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw
  }
  if (raw instanceof Date) {
    return raw.toISOString()
  }
  if (typeof raw === 'object') {
    if ('richText' in raw && Array.isArray(raw.richText)) {
      return raw.richText.map(part => part.text).join('')
    }
    if ('result' in raw) {
      const result = raw.result
      if (result === null || result === undefined) return null
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
        return result
      }
      if (result instanceof Date) return result.toISOString()
      if (typeof result === 'object' && 'error' in result) return String(result.error)
      return String(result)
    }
    if ('text' in raw && typeof raw.text === 'string') {
      return raw.text
    }
    if ('error' in raw) {
      return String(raw.error)
    }
  }
  return String(raw)
}

/**
 * Coerce a string cell input to a number when it represents a plain finite
 * integer or decimal (matching OfficeBench's `fire.Fire` CLI argument coercion).
 * Preserves leading-zero identifiers such as `"00123"`.
 *
 * @param input - Input text or primitive cell value.
 * @returns Coerced value to write to the cell.
 */
export function coerceExcelInputValue(input: string | number | boolean): string | number | boolean {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && String(parsed) === trimmed) {
      return parsed
    }
  }
  return input
}

/**
 * Read a workbook from a host path and return structured rows plus OfficeBench's
 * `(row, col): value\t` string representation.
 *
 * @param hostPath - Absolute path to the `.xlsx` file.
 * @param sheetName - Optional sheet name; defaults to the first worksheet.
 * @returns Structured grid, sheet names, and OfficeBench formatted string.
 */
export async function readExcelWorkbookHost(
  hostPath: string,
  sheetName?: string,
): Promise<{
  readonly sheetName: string
  readonly sheets: readonly string[]
  readonly rowCount: number
  readonly columnCount: number
  readonly rows: readonly (readonly ExcelCellScalar[])[]
  readonly formatted: string
}> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(hostPath)
  const sheets = workbook.worksheets.map(ws => ws.name)
  const worksheet = sheetName === undefined
    ? workbook.worksheets[0]
    : workbook.getWorksheet(sheetName)
  if (worksheet === undefined) {
    throw new OfficeBenchError(
      sheetName === undefined
        ? `Excel workbook "${hostPath}" contains no worksheets`
        : `Worksheet "${sheetName}" not found in "${hostPath}" (available: ${sheets.join(', ')})`,
      'OFFICEBENCH_EXCEL_SHEET_NOT_FOUND',
    )
  }

  const rowCount = worksheet.rowCount
  const columnCount = worksheet.columnCount
  const rows: ExcelCellScalar[][] = []
  let formatted = ''

  for (let r = 1; r <= rowCount; r++) {
    const rowData: ExcelCellScalar[] = []
    for (let c = 1; c <= columnCount; c++) {
      const value = unwrapExcelCellValue(worksheet.getCell(r, c).value)
      rowData.push(value)
      const display = value === null ? '[Empty Cell]' : String(value)
      formatted += `(${r}, ${c}): ${display}\t`
    }
    rows.push(rowData)
    formatted += '\n'
  }

  return {
    sheetName: worksheet.name,
    sheets,
    rowCount,
    columnCount,
    rows,
    formatted,
  }
}

/**
 * Read an Excel file inside a run's testbed.
 *
 * @param testbedDir - Isolated testbed root.
 * @param filePath - Path inside the testbed.
 * @param sheet - Optional worksheet name.
 */
export async function excelReadFile(
  testbedDir: string,
  filePath: string,
  sheet?: string,
): Promise<ExcelReadResult> {
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to read the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }
  const data = await readExcelWorkbookHost(resolved.hostPath, sheet)
  return {
    file_path: resolved.virtualPath,
    sheet_name: data.sheetName,
    sheets: data.sheets,
    row_count: data.rowCount,
    column_count: data.columnCount,
    rows: data.rows,
    formatted: data.formatted,
  }
}

/**
 * Create a new empty Excel workbook inside a run's testbed.
 *
 * @param testbedDir - Isolated testbed root.
 * @param filePath - Target `.xlsx` path inside the testbed.
 */
export async function excelCreateNewFile(
  testbedDir: string,
  filePath: string,
): Promise<ExcelCreateResult> {
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (existsSync(resolved.hostPath)) {
    return {
      ok: true,
      file_path: resolved.virtualPath,
      already_existed: true,
    }
  }
  await mkdir(dirname(resolved.hostPath), { recursive: true })
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Sheet')
  await workbook.xlsx.writeFile(resolved.hostPath)
  return {
    ok: true,
    file_path: resolved.virtualPath,
    already_existed: false,
  }
}

function validateCellCoordinate(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new OfficeBenchError(
      `Invalid ${label} (${String(value)}): Excel coordinates are 1-based positive integers`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }
  return value
}

/**
 * Set a 1-based cell value in an existing Excel file.
 *
 * @param testbedDir - Isolated testbed root.
 * @param filePath - Path to the `.xlsx` file.
 * @param rowIdx - 1-based row index.
 * @param columnIdx - 1-based column index.
 * @param text - Value to write (strings representing plain numbers are stored numerically).
 * @param sheetName - Optional worksheet name (created if absent; defaults to active sheet).
 */
export async function excelSetCell(
  testbedDir: string,
  filePath: string,
  rowIdx: number,
  columnIdx: number,
  text: string | number | boolean,
  sheetName?: string,
): Promise<ExcelMutateCellResult> {
  const row = validateCellCoordinate(rowIdx, 'row_idx')
  const col = validateCellCoordinate(columnIdx, 'column_idx')
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to write to the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(resolved.hostPath)
  let worksheet = sheetName === undefined ? workbook.worksheets[0] : workbook.getWorksheet(sheetName)
  if (worksheet === undefined) {
    worksheet = workbook.addWorksheet(sheetName ?? 'Sheet')
  }

  const coerced = coerceExcelInputValue(text)
  worksheet.getCell(row, col).value = coerced
  await workbook.xlsx.writeFile(resolved.hostPath)

  return {
    ok: true,
    file_path: resolved.virtualPath,
    sheet_name: worksheet.name,
    row_idx: row,
    column_idx: col,
    value: coerced,
  }
}

/**
 * Clear a 1-based cell in an existing Excel file.
 *
 * @param testbedDir - Isolated testbed root.
 * @param filePath - Path to the `.xlsx` file.
 * @param rowIdx - 1-based row index.
 * @param columnIdx - 1-based column index.
 * @param sheetName - Optional worksheet name.
 */
export async function excelDeleteCell(
  testbedDir: string,
  filePath: string,
  rowIdx: number,
  columnIdx: number,
  sheetName?: string,
): Promise<ExcelMutateCellResult> {
  const row = validateCellCoordinate(rowIdx, 'row_idx')
  const col = validateCellCoordinate(columnIdx, 'column_idx')
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to delete the cell in the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(resolved.hostPath)
  let worksheet = sheetName === undefined ? workbook.worksheets[0] : workbook.getWorksheet(sheetName)
  if (worksheet === undefined) {
    worksheet = workbook.addWorksheet(sheetName ?? 'Sheet')
  }

  worksheet.getCell(row, col).value = null
  await workbook.xlsx.writeFile(resolved.hostPath)

  return {
    ok: true,
    file_path: resolved.virtualPath,
    sheet_name: worksheet.name,
    row_idx: row,
    column_idx: col,
    value: null,
  }
}

/** Detect an installed LibreOffice (`soffice` / `libreoffice`) binary path if available. */
export async function findLibreOfficeBinary(configuredPath?: string): Promise<string | undefined> {
  const candidates: string[] = []
  if (configuredPath !== undefined && configuredPath.trim() !== '') {
    candidates.push(configuredPath.trim())
  }
  if (process.platform === 'win32') {
    candidates.push(
      'soffice',
      'libreoffice',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    )
  } else if (process.platform === 'darwin') {
    candidates.push(
      'soffice',
      'libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    )
  } else {
    candidates.push('libreoffice', 'soffice')
  }

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 5000 })
      return candidate
    } catch (_error: unknown) {
      // Candidate not installed or not executable; try next path.
    }
  }
  return undefined
}

/** Sanitize text so `pdf-lib`'s WinAnsi Helvetica font never throws on smart punctuation or non-Latin glyphs. */
export function toWinAnsiSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

/**
 * Render lines of text into a clean multi-page PDF via `pdf-lib`.
 *
 * @param lines - Ordered text lines to write.
 * @returns PDF document bytes.
 */
export async function renderTextLinesToPdf(lines: readonly string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontSize = 10
  const lineHeight = 14
  const margin = 40
  const pageWidth = 595.28
  const pageHeight = 841.89
  const maxCharsPerLine = 92

  const wrapped: string[] = []
  for (const rawLine of lines) {
    const safe = toWinAnsiSafe(rawLine)
    if (safe.length <= maxCharsPerLine) {
      wrapped.push(safe)
      continue
    }
    for (let i = 0; i < safe.length; i += maxCharsPerLine) {
      wrapped.push(safe.slice(i, i + maxCharsPerLine))
    }
  }
  if (wrapped.length === 0) wrapped.push('')

  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin
  for (const line of wrapped) {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) })
    y -= lineHeight
  }
  return await pdfDoc.save()
}

/**
 * Convert an input document to PDF via LibreOffice when installed, moving the output
 * to the exact requested `pdfHostPath`.
 */
export async function convertWithLibreOffice(
  binary: string,
  inputHostPath: string,
  pdfHostPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const outDir = dirname(pdfHostPath)
  await mkdir(outDir, { recursive: true })
  await execFileAsync(
    binary,
    ['--headless', '--convert-to', 'pdf', inputHostPath, '--outdir', outDir],
    { timeout: 60_000, ...(signal === undefined ? {} : { signal }) },
  )
  const generatedName = `${basename(inputHostPath, extname(inputHostPath))}.pdf`
  const generatedPath = join(outDir, generatedName)
  if (generatedPath !== pdfHostPath && existsSync(generatedPath)) {
    if (existsSync(pdfHostPath)) await rm(pdfHostPath, { force: true })
    await rename(generatedPath, pdfHostPath)
  }
  if (!existsSync(pdfHostPath)) {
    throw new OfficeBenchError(
      `LibreOffice finished but expected PDF output "${pdfHostPath}" was not created`,
      'OFFICEBENCH_CONVERSION_FAILED',
    )
  }
}

/**
 * Convert an Excel workbook to PDF using LibreOffice if available, or a pure-JS
 * `pdf-lib` table renderer fallback so conversion always produces a readable PDF.
 *
 * @param testbedDir - Isolated testbed root.
 * @param excelFilePath - Source `.xlsx` path.
 * @param pdfFilePath - Target `.pdf` path.
 * @param options - Optional binary path override and cancellation signal.
 */
export async function excelConvertToPdf(
  testbedDir: string,
  excelFilePath: string,
  pdfFilePath: string,
  options: { readonly libreOfficePath?: string; readonly signal?: AbortSignal } = {},
): Promise<ExcelConvertPdfResult> {
  const source = resolveTestbedPath(testbedDir, excelFilePath)
  const target = resolveTestbedPath(testbedDir, pdfFilePath)
  if (!existsSync(source.hostPath)) {
    throw new OfficeBenchError(
      `${source.virtualPath} does not exist. Failed to convert ${source.virtualPath} to ${target.virtualPath}`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const libreOffice = await findLibreOfficeBinary(options.libreOfficePath)
  if (libreOffice !== undefined) {
    try {
      await convertWithLibreOffice(libreOffice, source.hostPath, target.hostPath, options.signal)
      return {
        ok: true,
        excel_file_path: source.virtualPath,
        pdf_file_path: target.virtualPath,
        engine: 'libreoffice',
      }
    } catch (_error: unknown) {
      // Fall back to pure-JS PDF rendering if LibreOffice fails in a restricted environment.
    }
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(source.hostPath)
  const lines: string[] = []
  for (const ws of workbook.worksheets) {
    if (workbook.worksheets.length > 1) {
      lines.push(`=== Sheet: ${ws.name} ===`)
    }
    for (let r = 1; r <= ws.rowCount; r++) {
      const cells: string[] = []
      for (let c = 1; c <= ws.columnCount; c++) {
        const val = unwrapExcelCellValue(ws.getCell(r, c).value)
        cells.push(val === null ? '' : String(val))
      }
      lines.push(cells.join(' | '))
    }
    lines.push('')
  }

  await mkdir(dirname(target.hostPath), { recursive: true })
  const bytes = await renderTextLinesToPdf(lines)
  await writeFile(target.hostPath, bytes)
  // Verify the written file is readable.
  await readFile(target.hostPath)
  return {
    ok: true,
    excel_file_path: source.virtualPath,
    pdf_file_path: target.virtualPath,
    engine: 'pdf-lib-fallback',
  }
}

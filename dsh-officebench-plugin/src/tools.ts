/**
 * Model-facing OfficeBench tool definitions built with `defineTool` so they work
 * seamlessly both as native tools and as strongly-typed `await tools.<name>(args)`
 * TypeScript bindings inside PTC `run_code`.
 *
 * @module dsh-officebench-plugin/tools
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { listTestbedFiles } from './dataset.ts'
import { calendarCreateEvent, calendarDeleteEvent, calendarListEvents } from './office/calendar.ts'
import { emailListEmails, emailReadEmail, emailSendEmail } from './office/email.ts'
import {
  excelConvertToPdf,
  excelCreateNewFile,
  excelDeleteCell,
  excelReadFile,
  excelSetCell,
} from './office/excel.ts'
import { ocrRecognizeFile } from './office/ocr.ts'
import { imageConvertToPdf, pdfConvertToImage, pdfConvertToWord, pdfReadFile } from './office/pdf.ts'
import { runShellCommand } from './office/shell.ts'
import { wordConvertToPdf, wordCreateNewFile, wordReadFile, wordWriteToFile } from './office/word.ts'
import { OfficeBenchError, resolveTestbedPath } from './path-resolver.ts'
import type { ResolvedOfficeBenchConfig } from './types.ts'

/** Dependency hooks supplied by the mounting plugin to resolve each invocation's testbed root. */
export interface OfficeBenchToolsDeps {
  /** Resolve the active testbed root directory for an execution context. */
  readonly resolveTestbedDir: (exec: ToolRunContext) => Promise<string>
  /** Read validated OfficeBench runtime configuration. */
  readonly getConfig: () => ResolvedOfficeBenchConfig
}

const EXCEL_CELL_SCHEMA = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
  ],
} as const

/** Complete list of wire tool names exposed by `dsh-officebench-plugin/tools`. */
export const OFFICEBENCH_TOOL_NAMES = [
  'officebench_list_files',
  'officebench_read_text',
  'excel_read_file',
  'excel_create_new_file',
  'excel_set_cell',
  'excel_delete_cell',
  'excel_convert_to_pdf',
  'word_create_new_file',
  'word_read_file',
  'word_write_to_file',
  'word_convert_to_pdf',
  'pdf_read_file',
  'pdf_convert_to_word',
  'pdf_convert_to_image',
  'image_convert_to_pdf',
  'ocr_recognize_file',
  'email_list_emails',
  'email_read_email',
  'email_send_email',
  'calendar_list_events',
  'calendar_create_event',
  'calendar_delete_event',
  'shell_command',
  'finish_task',
] as const

export type OfficeBenchToolName = (typeof OFFICEBENCH_TOOL_NAMES)[number]

/**
 * Construct all OfficeBench tool definitions wired to `deps.resolveTestbedDir`.
 *
 * Read-only tools declare `isConcurrencySafe: () => true` so PTC programs can
 * batch reads concurrently with `Promise.all(...)`. Mutating tools remain
 * exclusive so sequential edits in loops never race on files.
 *
 * @param deps - Testbed resolution and config accessors.
 * @returns Ordered array of `ToolDefinition` instances ready for `ctx.tools.register`.
 */
export function createOfficeBenchTools(deps: OfficeBenchToolsDeps): ToolDefinition[] {
  const listFilesTool = defineTool({
    name: 'officebench_list_files',
    description: 'List all files in the OfficeBench testbed (optionally filtered by subdirectory such as "/testbed/data", "/testbed/emails", or "/testbed/calendar").',
    parameters: {
      directory: {
        type: 'string',
        description: 'Optional testbed directory path (default "/testbed").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          directory: { type: 'string', required: true },
          files: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                relative_path: { type: 'string', required: true },
                category: { type: 'string', required: true },
                size_bytes: { type: 'number', required: true },
                extension: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.files.length === 0
          ? `No files found under ${value.directory}.`
          : `Files under ${value.directory} (${value.files.length}):\n${value.files.map(file => `- ${file.path} (${file.size_bytes} bytes)`).join('\n')}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'search',
      title: `List ${args.directory ?? '/testbed'}`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const resolved = resolveTestbedPath(testbedDir, args.directory ?? '/testbed')
      const allFiles = await listTestbedFiles(testbedDir)
      const prefix = resolved.relativePath === '' ? '' : `${resolved.relativePath}/`
      const matched = prefix === ''
        ? allFiles
        : allFiles.filter(file => file.relativePath === resolved.relativePath || file.relativePath.startsWith(prefix))
      return {
        directory: resolved.virtualPath,
        files: matched.map(file => ({
          path: `/testbed/${file.relativePath}`,
          relative_path: file.relativePath,
          category: file.category,
          size_bytes: file.sizeBytes,
          extension: file.extension,
        })),
      }
    },
  })

  const readTextTool = defineTool({
    name: 'officebench_read_text',
    description: 'Read a plain-text file (such as .txt, .csv, .ics, .eml, or answer.txt) inside the OfficeBench testbed.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the text file inside /testbed (e.g. "/testbed/data/reference.txt").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Content of ${value.file_path}:\n${value.text}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Read ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const resolved = resolveTestbedPath(testbedDir, args.file_path)
      if (!existsSync(resolved.hostPath)) {
        throw new OfficeBenchError(
          `The file ${resolved.virtualPath} does not exist. Failed to read the file.`,
          'OFFICEBENCH_FILE_NOT_FOUND',
        )
      }
      const text = await readFile(resolved.hostPath, 'utf8')
      return { file_path: resolved.virtualPath, text }
    },
  })

  const excelReadTool = defineTool({
    name: 'excel_read_file',
    description: 'Read an Excel (.xlsx) workbook. Returns both a 2D `rows` matrix (0-indexed rows/columns for easy TypeScript processing) and the exact OfficeBench 1-based `(row, col): value` table string in `formatted`.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the Excel file (e.g. "/testbed/data/score.xlsx").',
      },
      sheet: {
        type: 'string',
        description: 'Optional worksheet name (defaults to the first/active sheet).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string', required: true },
          sheet_name: { type: 'string', required: true },
          sheets: { type: 'array', required: true, items: { type: 'string' } },
          row_count: { type: 'number', required: true },
          column_count: { type: 'number', required: true },
          rows: { type: 'array', required: true, items: { type: 'array', items: EXCEL_CELL_SCHEMA } },
          formatted: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: The following is the table from ${value.file_path} (sheet "${value.sheet_name}", ${value.row_count}x${value.column_count}):\n${value.formatted}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Excel read ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const res = await excelReadFile(testbedDir, args.file_path, args.sheet)
      return {
        ...res,
        sheets: [...res.sheets],
        rows: res.rows.map(row => [...row]),
      }
    },
  })

  const excelCreateTool = defineTool({
    name: 'excel_create_new_file',
    description: 'Create a new empty Excel (.xlsx) workbook with an active worksheet.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Target path for the new Excel file (e.g. "/testbed/data/sorted_score.xlsx").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
          already_existed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.already_existed
          ? `OBSERVATION: File ${value.file_path} already exists`
          : `OBSERVATION: Successfully create new file ${value.file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Excel create ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await excelCreateNewFile(testbedDir, args.file_path)
    },
  })

  const excelSetCellTool = defineTool({
    name: 'excel_set_cell',
    description: 'Write a value to a cell in an existing Excel (.xlsx) file using 1-based `row_idx` and `column_idx`. Numeric strings are stored as numbers.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the existing Excel file.',
      },
      row_idx: {
        type: 'integer',
        required: true,
        description: '1-based row index.',
      },
      column_idx: {
        type: 'integer',
        required: true,
        description: '1-based column index.',
      },
      text: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
        required: true,
        description: 'Text or numeric value to write into the cell.',
      },
      sheet_name: {
        type: 'string',
        description: 'Optional worksheet name (defaults to the active sheet).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
          sheet_name: { type: 'string', required: true },
          row_idx: { type: 'number', required: true },
          column_idx: { type: 'number', required: true },
          value: { ...EXCEL_CELL_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully wrote ${JSON.stringify(value.value)} to (${value.row_idx}, ${value.column_idx}) in ${value.file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Excel set (${args.row_idx}, ${args.column_idx}) in ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await excelSetCell(testbedDir, args.file_path, args.row_idx, args.column_idx, args.text, args.sheet_name)
    },
  })

  const excelDeleteCellTool = defineTool({
    name: 'excel_delete_cell',
    description: 'Clear a cell in an existing Excel (.xlsx) file using 1-based `row_idx` and `column_idx`.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the existing Excel file.',
      },
      row_idx: {
        type: 'integer',
        required: true,
        description: '1-based row index.',
      },
      column_idx: {
        type: 'integer',
        required: true,
        description: '1-based column index.',
      },
      sheet_name: {
        type: 'string',
        description: 'Optional worksheet name (defaults to the active sheet).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
          sheet_name: { type: 'string', required: true },
          row_idx: { type: 'number', required: true },
          column_idx: { type: 'number', required: true },
          value: { ...EXCEL_CELL_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully cleared (${value.row_idx}, ${value.column_idx}) in ${value.file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Excel delete (${args.row_idx}, ${args.column_idx}) in ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await excelDeleteCell(testbedDir, args.file_path, args.row_idx, args.column_idx, args.sheet_name)
    },
  })

  const excelConvertToPdfTool = defineTool({
    name: 'excel_convert_to_pdf',
    description: 'Convert an Excel (.xlsx) workbook into a PDF file.',
    parameters: {
      excel_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the source Excel file.',
      },
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the output PDF file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          excel_file_path: { type: 'string', required: true },
          pdf_file_path: { type: 'string', required: true },
          engine: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully convert ${value.excel_file_path} to ${value.pdf_file_path} (${value.engine})`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Excel -> PDF ${args.excel_file_path}`,
      locations: [{ path: args.excel_file_path }, { path: args.pdf_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const cfg = deps.getConfig()
      return await excelConvertToPdf(testbedDir, args.excel_file_path, args.pdf_file_path, {
        ...(cfg.libreOfficePath === undefined ? {} : { libreOfficePath: cfg.libreOfficePath }),
        signal: exec.signal,
      })
    },
  })

  const wordCreateTool = defineTool({
    name: 'word_create_new_file',
    description: 'Create a new empty Word (.docx) document.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the new Word file (e.g. "/testbed/data/report.docx").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully create new file ${value.file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Word create ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await wordCreateNewFile(testbedDir, args.file_path)
    },
  })

  const wordReadTool = defineTool({
    name: 'word_read_file',
    description: 'Read all paragraphs from a Word (.docx) file.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the Word (.docx) file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string', required: true },
          paragraphs: { type: 'array', required: true, items: { type: 'string' } },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: The following is the content from ${value.file_path}:\n${value.text}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Word read ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const res = await wordReadFile(testbedDir, args.file_path)
      return { ...res, paragraphs: [...res.paragraphs] }
    },
  })

  const wordWriteTool = defineTool({
    name: 'word_write_to_file',
    description: 'Append a paragraph or heading to an existing Word (.docx) document.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the existing Word (.docx) file.',
      },
      contents: {
        type: 'string',
        required: true,
        description: 'Text content to append.',
      },
      style: {
        type: 'string',
        enum: ['pure-text', 'title', 'subtitle'],
        description: 'Paragraph style: "pure-text" (default), "title", or "subtitle".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
          style: { type: 'string', required: true },
          paragraphs_added: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully write contents to ${value.file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Word write ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const style = (args.style ?? 'pure-text') as 'pure-text' | 'title' | 'subtitle'
      return await wordWriteToFile(testbedDir, args.file_path, args.contents, style)
    },
  })

  const wordConvertToPdfTool = defineTool({
    name: 'word_convert_to_pdf',
    description: 'Convert a Word (.docx) document to a PDF file.',
    parameters: {
      word_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the source Word file.',
      },
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the output PDF file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          word_file_path: { type: 'string', required: true },
          pdf_file_path: { type: 'string', required: true },
          engine: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully convert ${value.word_file_path} to ${value.pdf_file_path} (${value.engine})`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Word -> PDF ${args.word_file_path}`,
      locations: [{ path: args.word_file_path }, { path: args.pdf_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const cfg = deps.getConfig()
      return await wordConvertToPdf(testbedDir, args.word_file_path, args.pdf_file_path, {
        ...(cfg.libreOfficePath === undefined ? {} : { libreOfficePath: cfg.libreOfficePath }),
        signal: exec.signal,
      })
    },
  })

  const pdfReadTool = defineTool({
    name: 'pdf_read_file',
    description: 'Extract text from every page of a PDF file.',
    parameters: {
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the PDF file (e.g. "/testbed/data/report.pdf").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pdf_file_path: { type: 'string', required: true },
          page_count: { type: 'number', required: true },
          pages: { type: 'array', required: true, items: { type: 'string' } },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: ${value.pdf_file_path} (${value.page_count} page(s)):\n${value.text}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `PDF read ${args.pdf_file_path}`,
      locations: [{ path: args.pdf_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const res = await pdfReadFile(testbedDir, args.pdf_file_path)
      return { ...res, pages: [...res.pages] }
    },
  })

  const pdfConvertToWordTool = defineTool({
    name: 'pdf_convert_to_word',
    description: 'Convert a PDF file to a Word (.docx) document.',
    parameters: {
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the source PDF file.',
      },
      word_file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the output Word (.docx) file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          pdf_file_path: { type: 'string', required: true },
          word_file_path: { type: 'string', required: true },
          page_count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully converted ${value.pdf_file_path} (${value.page_count} page(s)) to ${value.word_file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `PDF -> Word ${args.pdf_file_path}`,
      locations: [{ path: args.pdf_file_path }, { path: args.word_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await pdfConvertToWord(testbedDir, args.pdf_file_path, args.word_file_path)
    },
  })

  const pdfConvertToImageTool = defineTool({
    name: 'pdf_convert_to_image',
    description: 'Render the first page of a PDF file into an image file (.png or .jpg).',
    parameters: {
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the source PDF file.',
      },
      image_file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the output image file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          pdf_file_path: { type: 'string', required: true },
          image_file_path: { type: 'string', required: true },
          engine: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully converted ${value.pdf_file_path} to ${value.image_file_path} (${value.engine})`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `PDF -> Image ${args.pdf_file_path}`,
      locations: [{ path: args.pdf_file_path }, { path: args.image_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const cfg = deps.getConfig()
      return await pdfConvertToImage(testbedDir, args.pdf_file_path, args.image_file_path, {
        ...(cfg.pythonPath === undefined ? {} : { pythonPath: cfg.pythonPath }),
        signal: exec.signal,
      })
    },
  })

  const imageConvertToPdfTool = defineTool({
    name: 'image_convert_to_pdf',
    description: 'Convert a PNG or JPEG image file to a single-page PDF file.',
    parameters: {
      image_file_path: {
        type: 'string',
        required: true,
        description: 'Path to the source PNG or JPEG image.',
      },
      pdf_file_path: {
        type: 'string',
        required: true,
        description: 'Destination path for the output PDF file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          image_file_path: { type: 'string', required: true },
          pdf_file_path: { type: 'string', required: true },
          width: { type: 'number', required: true },
          height: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully converted ${value.image_file_path} to ${value.pdf_file_path}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Image -> PDF ${args.image_file_path}`,
      locations: [{ path: args.image_file_path }, { path: args.pdf_file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await imageConvertToPdf(testbedDir, args.image_file_path, args.pdf_file_path)
    },
  })

  const ocrRecognizeTool = defineTool({
    name: 'ocr_recognize_file',
    description: 'Recognize text from an image file (.png, .jpg, .jpeg) using OCR.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the image file inside /testbed.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string', required: true },
          text: { type: 'string', required: true },
          engine: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: The text from ${value.file_path} (${value.engine}) is:\n${value.text}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `OCR ${args.file_path}`,
      locations: [{ path: args.file_path }],
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const cfg = deps.getConfig()
      return await ocrRecognizeFile(testbedDir, args.file_path, {
        language: cfg.ocrLanguage,
        ...(cfg.tesseractPath === undefined ? {} : { tesseractPath: cfg.tesseractPath }),
        signal: exec.signal,
      })
    },
  })

  const emailListTool = defineTool({
    name: 'email_list_emails',
    description: 'List all emails for a given username (returns structured email objects including email_id, from, to, subject, preview, and full content).',
    parameters: {
      username: {
        type: 'string',
        required: true,
        description: 'Mailbox owner username (e.g. "Alice", "Bob").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string', required: true },
          emails: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                email_id: { type: 'string', required: true },
                from: { type: 'string', required: true },
                to: { type: 'string', required: true },
                subject: { type: 'string', required: true },
                content: { type: 'string', required: true },
                preview: { type: 'string', required: true },
              },
            },
          },
          formatted: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.emails.length === 0
          ? `OBSERVATION: No emails found for ${value.username}.`
          : `OBSERVATION: Successfully list emails for ${value.username}:\n${value.formatted}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Email list (${args.username})`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const res = await emailListEmails(testbedDir, args.username)
      return { ...res, emails: [...res.emails] }
    },
  })

  const emailReadTool = defineTool({
    name: 'email_read_email',
    description: 'Read a user email by its Email ID (`.eml` filename).',
    parameters: {
      username: {
        type: 'string',
        required: true,
        description: 'Mailbox owner username.',
      },
      email_id: {
        type: 'string',
        required: true,
        description: 'Email ID / filename (with or without `.eml`).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string', required: true },
          email_id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully read email ${value.email_id} for ${value.username}:\nFrom: ${value.from}\nTo: ${value.to}\nSubject: ${value.subject}\nContent: ${value.content}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Email read ${args.username}/${args.email_id}`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await emailReadEmail(testbedDir, args.username, args.email_id)
    },
  })

  const emailSendTool = defineTool({
    name: 'email_send_email',
    description: 'Send an email from a single sender to a single recipient (writes `.eml` files to both mailboxes). Call in a loop to send to multiple recipients.',
    parameters: {
      sender: {
        type: 'string',
        required: true,
        description: 'Sender username or email address.',
      },
      recipient: {
        type: 'string',
        required: true,
        description: 'Single recipient username or email address.',
      },
      subject: {
        type: 'string',
        required: true,
        description: 'Email subject line.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Email body text.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          sender: { type: 'string', required: true },
          recipient: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          recipient_file: { type: 'string', required: true },
          sender_file: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully sent email "${value.subject}" from ${value.sender} to ${value.recipient}.`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Send email to ${args.recipient}: ${args.subject}`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await emailSendEmail(testbedDir, args.sender, args.recipient, args.subject, args.content)
    },
  })

  const calendarListTool = defineTool({
    name: 'calendar_list_events',
    description: 'List all events from a user calendar (`/testbed/calendar/<username>.ics`).',
    parameters: {
      username: {
        type: 'string',
        required: true,
        description: 'Calendar owner username (e.g. "Bob", "Alice").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string', required: true },
          events: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string', required: true },
                time_start: { type: 'string', required: true },
                time_end: { type: 'string', required: true },
                description: { type: 'string', required: true },
                location: { type: 'string', required: true },
              },
            },
          },
          formatted: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.events.length === 0
          ? `OBSERVATION: No events found for ${value.username}.`
          : `OBSERVATION: Successfully list events for ${value.username}:\n${value.formatted}`,
      }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({
      card: 'generic',
      kind: 'read',
      title: `Calendar list (${args.username})`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const res = await calendarListEvents(testbedDir, args.username)
      return {
        username: res.username,
        events: res.events.map(event => ({
          summary: event.summary,
          time_start: event.time_start,
          time_end: event.time_end,
          description: event.description,
          location: event.location,
        })),
        formatted: res.formatted,
      }
    },
  })

  const calendarCreateTool = defineTool({
    name: 'calendar_create_event',
    description: 'Create a new event on a single user calendar. Time format must be "YYYY-MM-DD HH:MM:SS".',
    parameters: {
      user: {
        type: 'string',
        required: true,
        description: 'Single calendar owner username.',
      },
      summary: {
        type: 'string',
        required: true,
        description: 'Event title / summary.',
      },
      time_start: {
        type: 'string',
        required: true,
        description: 'Start timestamp in "YYYY-MM-DD HH:MM:SS" format.',
      },
      time_end: {
        type: 'string',
        required: true,
        description: 'End timestamp in "YYYY-MM-DD HH:MM:SS" format.',
      },
      description: {
        type: 'string',
        description: 'Optional event description.',
      },
      location: {
        type: 'string',
        description: 'Optional event location.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          user: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          time_start: { type: 'string', required: true },
          time_end: { type: 'string', required: true },
          file_path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `OBSERVATION: Successfully created event "${value.summary}" (${value.time_start} – ${value.time_end}) on ${value.user}'s calendar.`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Calendar create "${args.summary}" (${args.user})`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await calendarCreateEvent(
        testbedDir,
        args.user,
        args.summary,
        args.time_start,
        args.time_end,
        args.description,
        args.location,
      )
    },
  })

  const calendarDeleteTool = defineTool({
    name: 'calendar_delete_event',
    description: 'Delete an event matching `summary` from a user calendar.',
    parameters: {
      user: {
        type: 'string',
        required: true,
        description: 'Calendar owner username.',
      },
      summary: {
        type: 'string',
        required: true,
        description: 'Exact event summary to delete.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          user: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          deleted: { type: 'boolean', required: true },
          file_path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.deleted
          ? `OBSERVATION: Successfully delete an event named ${value.summary} from ${value.user}'s calendar.`
          : `OBSERVATION: No event named ${value.summary} found in ${value.user}'s calendar.`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'edit',
      title: `Calendar delete "${args.summary}" (${args.user})`,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      return await calendarDeleteEvent(testbedDir, args.user, args.summary)
    },
  })

  const shellCommandTool = defineTool({
    name: 'shell_command',
    description: 'Execute a shell command scoped to the OfficeBench testbed root (`/testbed` paths are mapped to the isolated testbed directory).',
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'Shell command to run (e.g. "ls /testbed/data", "rm /testbed/data/file3.xlsx").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', required: true },
          exit_code: { type: 'number', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          cwd: { type: 'string', required: true },
          timed_out: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => {
        const parts: string[] = []
        if (value.stdout !== '') parts.push(value.stdout)
        if (value.stderr !== '') parts.push(`[stderr]\n${value.stderr}`)
        const body = parts.length === 0 ? `(exit code ${value.exit_code}, no output)` : parts.join('\n')
        return [{ type: 'text', text: `OBSERVATION: ${body}` }]
      },
    },
    presentCall: args => ({
      card: 'terminal',
      title: args.command,
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const cfg = deps.getConfig()
      return await runShellCommand(testbedDir, args.command, {
        timeoutMs: cfg.shellTimeoutMs,
        signal: exec.signal,
      })
    },
  })

  const finishTaskTool = defineTool({
    name: 'finish_task',
    description: 'Mark the OfficeBench task complete. If the task asks a question, pass the answer in `answer` so it is recorded to `/testbed/data/answer.txt`.',
    parameters: {
      answer: {
        type: 'string',
        description: 'Final answer string to write to `/testbed/data/answer.txt`. Omit or pass "None" if the task does not ask a question.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          finished: { type: 'boolean', required: true },
          answer_path: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
          },
          answer: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.answer_path === null
          ? 'OBSERVATION: Task finished.'
          : `OBSERVATION: Task finished. Recorded answer to ${value.answer_path}: ${value.answer ?? ''}`,
      }],
    },
    presentCall: args => ({
      card: 'generic',
      kind: 'other',
      title: args.answer !== undefined && args.answer !== '' && args.answer !== 'None'
        ? `Finish task: ${args.answer.slice(0, 60)}`
        : 'Finish task',
    }),
    async execute(args, exec) {
      const testbedDir = await deps.resolveTestbedDir(exec)
      const rawAnswer = args.answer
      const shouldWrite = rawAnswer !== undefined && rawAnswer.trim() !== '' && rawAnswer.trim() !== 'None'
      const answerHostPath = join(testbedDir, 'data', 'answer.txt')
      if (shouldWrite) {
        await mkdir(dirname(answerHostPath), { recursive: true })
        await writeFile(answerHostPath, `${rawAnswer.trim()}\n`, 'utf8')
        return {
          finished: true,
          answer_path: '/testbed/data/answer.txt',
          answer: rawAnswer.trim(),
        }
      }
      return {
        finished: true,
        answer_path: null,
        answer: null,
      }
    },
  })

  return [
    listFilesTool,
    readTextTool,
    excelReadTool,
    excelCreateTool,
    excelSetCellTool,
    excelDeleteCellTool,
    excelConvertToPdfTool,
    wordCreateTool,
    wordReadTool,
    wordWriteTool,
    wordConvertToPdfTool,
    pdfReadTool,
    pdfConvertToWordTool,
    pdfConvertToImageTool,
    imageConvertToPdfTool,
    ocrRecognizeTool,
    emailListTool,
    emailReadTool,
    emailSendTool,
    calendarListTool,
    calendarCreateTool,
    calendarDeleteTool,
    shellCommandTool,
    finishTaskTool,
  ]
}

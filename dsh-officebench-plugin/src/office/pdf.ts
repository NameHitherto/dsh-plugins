/**
 * PDF office operations (`pdf_read_file`, `pdf_convert_to_word`, `pdf_convert_to_image`,
 * `image_convert_to_pdf`) using `unpdf`, `pdf-lib`, and optional Python `pymupdf` (`fitz`)
 * for rasterizing PDF pages to images.
 *
 * @module dsh-officebench-plugin/office/pdf
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import { extractText } from 'unpdf'
import { OfficeBenchError, resolveTestbedPath } from '../path-resolver.ts'
import { appendDocxParagraphHost, createDocxHost } from './word.ts'

const execFileAsync = promisify(execFile)

/** Result of reading a PDF file. */
export interface PdfReadResult {
  readonly pdf_file_path: string
  readonly page_count: number
  readonly pages: readonly string[]
  readonly text: string
}

/** Result of converting a PDF to Word. */
export interface PdfConvertToWordResult {
  readonly ok: true
  readonly pdf_file_path: string
  readonly word_file_path: string
  readonly page_count: number
}

/** Result of converting a PDF page to an image. */
export interface PdfConvertToImageResult {
  readonly ok: true
  readonly pdf_file_path: string
  readonly image_file_path: string
  readonly engine: 'pymupdf' | 'pdftoppm'
}

/** Result of converting an image to a PDF. */
export interface ImageConvertToPdfResult {
  readonly ok: true
  readonly image_file_path: string
  readonly pdf_file_path: string
  readonly width: number
  readonly height: number
}

/**
 * Extract per-page text from a PDF file on disk using `unpdf`.
 *
 * @param hostPath - Absolute path to the `.pdf` file.
 * @returns Page count, per-page strings, and combined text.
 */
export async function readPdfHost(hostPath: string): Promise<{
  readonly pageCount: number
  readonly pages: readonly string[]
  readonly text: string
}> {
  const bytes = await readFile(hostPath)
  const result = await extractText(new Uint8Array(bytes), { mergePages: false })
  const pages = Array.isArray(result.text) ? result.text : [String(result.text)]
  return {
    pageCount: result.totalPages,
    pages,
    text: pages.join('\n'),
  }
}

/** Read a PDF file inside a run's testbed. */
export async function pdfReadFile(
  testbedDir: string,
  pdfFilePath: string,
): Promise<PdfReadResult> {
  const resolved = resolveTestbedPath(testbedDir, pdfFilePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The pdf file ${resolved.virtualPath} does not exist. Failed to read the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }
  const data = await readPdfHost(resolved.hostPath)
  return {
    pdf_file_path: resolved.virtualPath,
    page_count: data.pageCount,
    pages: data.pages,
    text: data.text,
  }
}

/** Convert a PDF file to a Word `.docx` document containing the extracted text paragraphs. */
export async function pdfConvertToWord(
  testbedDir: string,
  pdfFilePath: string,
  wordFilePath: string,
): Promise<PdfConvertToWordResult> {
  const source = resolveTestbedPath(testbedDir, pdfFilePath)
  const target = resolveTestbedPath(testbedDir, wordFilePath)
  if (!existsSync(source.hostPath)) {
    throw new OfficeBenchError(
      `The pdf file ${source.virtualPath} does not exist. Failed to convert the file to word.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const data = await readPdfHost(source.hostPath)
  await createDocxHost(target.hostPath)
  for (const pageText of data.pages) {
    const lines = pageText.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim() !== '')
    if (lines.length === 0) continue
    for (const line of lines) {
      await appendDocxParagraphHost(target.hostPath, line, 'pure-text')
    }
  }

  return {
    ok: true,
    pdf_file_path: source.virtualPath,
    word_file_path: target.virtualPath,
    page_count: data.pageCount,
  }
}

/** Probe whether Python with PyMuPDF (`fitz`/`pymupdf`) is available on this host. */
export async function findPythonWithPyMuPdf(configuredPath?: string): Promise<string | undefined> {
  const candidates = [
    ...(configuredPath !== undefined && configuredPath.trim() !== '' ? [configuredPath.trim()] : []),
    ...(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']),
  ]
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['-c', 'import pymupdf'], { timeout: 5000 })
      return candidate
    } catch (_error: unknown) {
      try {
        await execFileAsync(candidate, ['-c', 'import fitz'], { timeout: 5000 })
        return candidate
      } catch (_inner: unknown) {
        // Try next python executable.
      }
    }
  }
  return undefined
}

/**
 * Convert the first page of a PDF file to an image (`.png` / `.jpg`), using Python
 * PyMuPDF when available or `pdftoppm` on POSIX hosts.
 */
export async function pdfConvertToImage(
  testbedDir: string,
  pdfFilePath: string,
  imageFilePath: string,
  options: { readonly pythonPath?: string; readonly signal?: AbortSignal } = {},
): Promise<PdfConvertToImageResult> {
  const source = resolveTestbedPath(testbedDir, pdfFilePath)
  const target = resolveTestbedPath(testbedDir, imageFilePath)
  if (!existsSync(source.hostPath)) {
    throw new OfficeBenchError(
      `The file ${source.virtualPath} does not exist. Failed to convert pdf to image.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }
  await mkdir(dirname(target.hostPath), { recursive: true })

  const python = await findPythonWithPyMuPdf(options.pythonPath)
  if (python !== undefined) {
    const script = [
      'import sys',
      'try:',
      '    import pymupdf as fitz',
      'except ImportError:',
      '    import fitz',
      'doc = fitz.open(sys.argv[1])',
      'page = doc.load_page(0)',
      'pix = page.get_pixmap()',
      'pix.save(sys.argv[2])',
      'doc.close()',
    ].join('\n')
    await execFileAsync(python, ['-c', script, source.hostPath, target.hostPath], {
      timeout: 30_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return {
      ok: true,
      pdf_file_path: source.virtualPath,
      image_file_path: target.virtualPath,
      engine: 'pymupdf',
    }
  }

  throw new OfficeBenchError(
    'Failed to convert PDF to image: PyMuPDF (`pymupdf` / `fitz`) was not found in the local Python environment. Install it with `pip install pymupdf` or configure `pythonPath`.',
    'OFFICEBENCH_PDF_IMAGE_UNAVAILABLE',
  )
}

/** Convert a PNG or JPEG image file to a single-page PDF via `pdf-lib`. */
export async function imageConvertToPdf(
  testbedDir: string,
  imageFilePath: string,
  pdfFilePath: string,
): Promise<ImageConvertToPdfResult> {
  const source = resolveTestbedPath(testbedDir, imageFilePath)
  const target = resolveTestbedPath(testbedDir, pdfFilePath)
  if (!existsSync(source.hostPath)) {
    throw new OfficeBenchError(
      `The file ${source.virtualPath} does not exist. Failed to convert image to pdf.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const imageBytes = await readFile(source.hostPath)
  const pdfDoc = await PDFDocument.create()
  const ext = extname(source.hostPath).toLowerCase()

  let embedded: Awaited<ReturnType<PDFDocument['embedPng']>>
  if (ext === '.png') {
    embedded = await pdfDoc.embedPng(imageBytes)
  } else if (ext === '.jpg' || ext === '.jpeg') {
    embedded = await pdfDoc.embedJpg(imageBytes)
  } else {
    throw new OfficeBenchError(
      `Unsupported image format "${ext}" for image_convert_to_pdf; expected .png, .jpg, or .jpeg`,
      'OFFICEBENCH_UNSUPPORTED_FORMAT',
    )
  }

  const { width, height } = embedded.scale(1)
  const page = pdfDoc.addPage([width, height])
  page.drawImage(embedded, { x: 0, y: 0, width, height })
  const pdfBytes = await pdfDoc.save()
  await mkdir(dirname(target.hostPath), { recursive: true })
  await writeFile(target.hostPath, pdfBytes)

  return {
    ok: true,
    image_file_path: source.virtualPath,
    pdf_file_path: target.virtualPath,
    width,
    height,
  }
}

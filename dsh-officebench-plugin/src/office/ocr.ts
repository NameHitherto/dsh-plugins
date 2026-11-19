/**
 * OCR office operations (`ocr_recognize_file`): prefers a local `tesseract` CLI
 * when installed and falls back to pure-JS/WASM `tesseract.js` so OCR works out of
 * the box without requiring system binary setup.
 *
 * @module dsh-officebench-plugin/office/ocr
 */

import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { OfficeBenchError, resolveTestbedPath } from '../path-resolver.ts'

const execFileAsync = promisify(execFile)

/** Result of OCR text extraction from an image file. */
export interface OcrRecognizeResult {
  readonly file_path: string
  readonly text: string
  readonly engine: 'tesseract-cli' | 'tesseract.js'
}

/** Detect an installed `tesseract` CLI executable if present. */
export async function findTesseractBinary(configuredPath?: string): Promise<string | undefined> {
  const candidates: string[] = []
  if (configuredPath !== undefined && configuredPath.trim() !== '') {
    candidates.push(configuredPath.trim())
  }
  if (process.platform === 'win32') {
    candidates.push(
      'tesseract',
      'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
      'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
    )
  } else {
    candidates.push('tesseract', '/usr/local/bin/tesseract', '/opt/homebrew/bin/tesseract')
  }

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 5000 })
      return candidate
    } catch (_error: unknown) {
      // Binary not found; continue checking candidates.
    }
  }
  return undefined
}

/**
 * Recognize text from an image file inside a run's testbed.
 *
 * @param testbedDir - Isolated testbed root.
 * @param filePath - Path to the image file inside the testbed.
 * @param options - OCR language, optional binary path, and cancellation signal.
 */
export async function ocrRecognizeFile(
  testbedDir: string,
  filePath: string,
  options: {
    readonly language?: string
    readonly tesseractPath?: string
    readonly signal?: AbortSignal
  } = {},
): Promise<OcrRecognizeResult> {
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to recognize text.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const lang = options.language ?? 'eng'
  const binary = await findTesseractBinary(options.tesseractPath)
  if (binary !== undefined) {
    const { stdout } = await execFileAsync(
      binary,
      [resolved.hostPath, 'stdout', '-l', lang],
      {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    )
    return {
      file_path: resolved.virtualPath,
      text: stdout.trim(),
      engine: 'tesseract-cli',
    }
  }

  options.signal?.throwIfAborted()
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang)
  try {
    options.signal?.throwIfAborted()
    const result = await worker.recognize(resolved.hostPath)
    return {
      file_path: resolved.virtualPath,
      text: result.data.text.trim(),
      engine: 'tesseract.js',
    }
  } finally {
    await worker.terminate()
  }
}

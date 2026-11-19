/**
 * Safe path resolution mapping OfficeBench `/testbed/...`, relative paths, and
 * workspace-rooted host paths strictly inside a run's isolated `testbedDir`.
 *
 * @module dsh-officebench-plugin/path-resolver
 */

import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Structured error thrown by OfficeBench tools and environment helpers. */
export class OfficeBenchError extends HarnessError {
  override readonly name = 'OfficeBenchError'

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
  }
}

/**
 * Normalize a relative path to POSIX forward slashes without leading `./` or `/`.
 *
 * @param rawPath - Raw path string.
 * @returns Clean POSIX relative path.
 */
export function toPosixRelative(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^(?:\.\/)+/, '')
}

/**
 * Format a host path inside `testbedDir` into OfficeBench's canonical `/testbed/...` display path.
 *
 * @param testbedDir - Isolated testbed root directory.
 * @param hostPath - Resolved host path inside `testbedDir`.
 * @returns Canonical `/testbed/...` path string.
 */
export function toVirtualTestbedPath(testbedDir: string, hostPath: string): string {
  const rel = relative(resolve(testbedDir), resolve(hostPath)).split(sep).join('/')
  if (rel === '' || rel === '.') return '/testbed'
  return `/testbed/${rel}`
}

/**
 * Resolve a model- or evaluator-supplied OfficeBench path strictly inside `testbedDir`.
 *
 * Supported spellings:
 * - `/testbed/data/score.xlsx` or `/testbed` (canonical OfficeBench virtual root)
 * - `data/score.xlsx`, `./data/score.xlsx`, `score.xlsx` (relative to `testbedDir`)
 * - `<testbedDir>/data/score.xlsx` (absolute host path already inside `testbedDir`)
 *
 * Paths escaping `testbedDir` (e.g. `../../etc/passwd` or unrelated absolute paths)
 * fail loudly with `OFFICEBENCH_PATH_OUTSIDE_TESTBED`.
 *
 * @param testbedDir - Absolute path of the run's isolated `testbed` directory.
 * @param rawPath - Path supplied by a tool call.
 * @returns Both the resolved absolute host path and canonical `/testbed/...` path.
 */
export function resolveTestbedPath(
  testbedDir: string,
  rawPath: string,
): { readonly hostPath: string; readonly virtualPath: string; readonly relativePath: string } {
  const root = resolve(testbedDir)
  const trimmed = rawPath.trim()
  if (trimmed === '') {
    throw new OfficeBenchError('Path must be a non-empty string', 'OFFICEBENCH_INVALID_PATH')
  }

  const slashNormalized = trimmed.replace(/\\/g, '/')
  let candidate: string

  if (slashNormalized === '/testbed' || slashNormalized === '/testbed/') {
    candidate = root
  } else if (slashNormalized.startsWith('/testbed/')) {
    candidate = resolve(root, slashNormalized.slice('/testbed/'.length))
  } else if (slashNormalized.startsWith('/data/') || slashNormalized === '/data'
    || slashNormalized.startsWith('/emails/') || slashNormalized === '/emails'
    || slashNormalized.startsWith('/calendar/') || slashNormalized === '/calendar') {
    // Models occasionally omit `/testbed` and pass `/data/...`.
    candidate = resolve(root, slashNormalized.slice(1))
  } else if (isAbsolute(trimmed)) {
    candidate = resolve(trimmed)
  } else {
    candidate = resolve(root, normalize(trimmed))
  }

  const rel = relative(root, candidate)
  const escaped = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  if (escaped) {
    throw new OfficeBenchError(
      `Path "${rawPath}" resolves outside the OfficeBench testbed (${root})`,
      'OFFICEBENCH_PATH_OUTSIDE_TESTBED',
    )
  }

  const relativePath = rel === '' ? '' : rel.split(sep).join('/')
  const virtualPath = relativePath === '' ? '/testbed' : `/testbed/${relativePath}`
  return { hostPath: candidate, virtualPath, relativePath }
}

/**
 * Sanitize a user-supplied filename segment (such as an email subject or username)
 * so it is safe on Windows, macOS, and Linux while keeping OfficeBench naming intuitive.
 *
 * @param segment - Raw filename stem or segment.
 * @param field - Field label for diagnostics.
 * @returns Safe single path segment.
 */
export function assertSafeSegment(segment: string, field: string): string {
  const trimmed = segment.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new OfficeBenchError(
      `Invalid ${field} "${segment}": must be a single non-empty path segment`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }
  return trimmed
}

/**
 * Sanitize an email subject into a cross-platform filename stem (preserving readable text).
 *
 * @param subject - Raw email subject line.
 * @returns Cross-platform safe filename stem.
 */
export function sanitizeEmailFilename(subject: string): string {
  const cleaned = subject
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
  return cleaned === '' ? 'untitled' : cleaned
}

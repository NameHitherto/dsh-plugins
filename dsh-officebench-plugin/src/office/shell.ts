/**
 * Scoped shell execution for OfficeBench `shell_command`: runs inside the task's
 * isolated `testbedDir`, rewrites `/testbed` references to the local testbed path,
 * and respects timeouts and `AbortSignal`.
 *
 * @module dsh-officebench-plugin/office/shell
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { OfficeBenchError } from '../path-resolver.ts'

/** Result of running a shell command inside an OfficeBench testbed. */
export interface ShellCommandResult {
  readonly command: string
  readonly exit_code: number
  readonly stdout: string
  readonly stderr: string
  readonly cwd: string
  readonly timed_out: boolean
}

const MAX_CAPTURE_BYTES = 256 * 1024

function findGitBashOnWindows(): string | undefined {
  const candidates = [
    process.env.GIT_BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

/**
 * Rewrite virtual `/testbed` references in a command string to the actual host
 * `testbedDir` path (using forward slashes for POSIX/Git Bash compatibility).
 */
export function rewriteTestbedReferences(command: string, testbedDir: string, usePosixSlashes: boolean): string {
  const replacement = usePosixSlashes
    ? resolve(testbedDir).replace(/\\/g, '/')
    : resolve(testbedDir)
  return command.replace(/(^|[\s"'=:(])\/testbed(?=$|\/|[\s"'|;&):])/g, `$1${replacement}`)
}

/**
 * Execute a shell command with `cwd` anchored at `testbedDir`.
 *
 * On Windows, prefers Git Bash when installed so standard OfficeBench POSIX
 * commands (`ls /testbed/data`, `cat`, `wc`, `grep`, `mv`, `rm`) work seamlessly;
 * falls back to PowerShell (`pwsh` / `powershell.exe`) otherwise.
 *
 * @param testbedDir - Isolated testbed root directory.
 * @param command - Shell command string.
 * @param options - Timeout budget and cancellation signal.
 */
export async function runShellCommand(
  testbedDir: string,
  command: string,
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<ShellCommandResult> {
  const trimmed = command.trim()
  if (trimmed === '') {
    throw new OfficeBenchError('Shell command must be a non-empty string', 'OFFICEBENCH_INVALID_ARGUMENT')
  }
  options.signal?.throwIfAborted()

  const root = resolve(testbedDir)
  let executable: string
  let args: string[]
  let usePosixSlashes = true

  if (process.platform === 'win32') {
    const gitBash = findGitBashOnWindows()
    if (gitBash !== undefined) {
      executable = gitBash
      args = ['-c', rewriteTestbedReferences(trimmed, root, true)]
      usePosixSlashes = true
    } else {
      executable = 'powershell.exe'
      args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', rewriteTestbedReferences(trimmed, root, false)]
      usePosixSlashes = false
    }
  } else {
    executable = '/bin/bash'
    args = ['-c', rewriteTestbedReferences(trimmed, root, true)]
  }

  return await new Promise<ShellCommandResult>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        OFFICEBENCH_TESTBED: usePosixSlashes ? root.replace(/\\/g, '/') : root,
      },
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const killChild = (): void => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill('SIGKILL')
          }
        }, 1500).unref()
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChild()
    }, options.timeoutMs)
    timer.unref()

    const onAbort = (): void => {
      killChild()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE_BYTES) {
        stdout += chunk.toString('utf8')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE_BYTES) {
        stderr += chunk.toString('utf8')
      }
    })

    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      rejectPromise(new OfficeBenchError(`Failed to spawn shell command: ${error.message}`, 'OFFICEBENCH_SHELL_SPAWN_FAILED', { cause: error }))
    })

    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted === true) {
        const abortError = new Error('Shell command aborted')
        abortError.name = 'AbortError'
        rejectPromise(abortError)
        return
      }
      resolvePromise({
        command: trimmed,
        exit_code: timedOut ? 124 : (code ?? 1),
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        cwd: '/testbed',
        timed_out: timedOut,
      })
    })
  })
}

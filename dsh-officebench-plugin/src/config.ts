/**
 * Schemastery configuration schema and load-time validation for `dsh-officebench-plugin`.
 *
 * @module dsh-officebench-plugin/config
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { OfficeBenchConfig, ResolvedOfficeBenchConfig } from './types.ts'

/** Default root for storing isolated OfficeBench run testbeds. */
export function defaultRunsDir(): string {
  const dshHome = process.env.DSH_HOME?.trim()
  if (dshHome !== undefined && dshHome !== '') {
    return resolve(dshHome, 'officebench-runs')
  }
  return join(homedir(), '.dsh', 'officebench-runs')
}

/** Schemastery schema validated by the Cordis loader. */
export const Config: z<OfficeBenchConfig> = z.object({
  datasetDir: z.string().default(''),
  runsDir: z.string().default(''),
  shellTimeoutMs: z.number().min(1000).max(600_000).default(30_000),
  ocrLanguage: z.string().default('eng'),
  libreOfficePath: z.string(),
  tesseractPath: z.string(),
  pythonPath: z.string(),
  registerToolsGlobally: z.boolean().default(false),
})

function optionalTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Validate and normalize plugin configuration at load time.
 *
 * @param config - Raw configuration from `cordis.yml` / `cordis.patch.yml` or caller.
 * @returns Detached, validated configuration specification.
 */
export function resolveConfig(config: OfficeBenchConfig = {}): ResolvedOfficeBenchConfig {
  const configuredDataset = (config.datasetDir ?? '').trim()
  const envDataset = (process.env.OFFICEBENCH_DIR ?? '').trim()
  const rawDataset = configuredDataset !== '' ? configuredDataset : envDataset
  const datasetDir = rawDataset === '' ? '' : resolve(rawDataset)

  const rawRuns = (config.runsDir ?? '').trim()
  const runsDir = rawRuns === '' ? defaultRunsDir() : resolve(rawRuns)

  const shellTimeoutMs = config.shellTimeoutMs ?? 30_000
  if (!Number.isFinite(shellTimeoutMs) || shellTimeoutMs < 1000 || shellTimeoutMs > 600_000) {
    throw new Error(`officebench: \`shellTimeoutMs\` must be between 1000 and 600000 (got ${String(shellTimeoutMs)})`)
  }

  const ocrLanguage = (config.ocrLanguage ?? 'eng').trim()
  if (ocrLanguage === '') {
    throw new Error('officebench: `ocrLanguage` must be a non-empty string')
  }

  const libreOfficePath = optionalTrimmed(config.libreOfficePath)
  const tesseractPath = optionalTrimmed(config.tesseractPath)
  const pythonPath = optionalTrimmed(config.pythonPath)
  const registerToolsGlobally = config.registerToolsGlobally ?? false

  return {
    datasetDir,
    runsDir,
    shellTimeoutMs,
    ocrLanguage,
    ...(libreOfficePath === undefined ? {} : { libreOfficePath }),
    ...(tesseractPath === undefined ? {} : { tesseractPath }),
    ...(pythonPath === undefined ? {} : { pythonPath }),
    registerToolsGlobally,
  }
}

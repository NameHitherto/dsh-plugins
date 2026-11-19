/**
 * Browser-side typed RPC client over `ctx.connection.rpc` (`/officebench`) plus
 * `dsh-resource://file/...` address helpers for opening testbed files in DSH's
 * built-in Document Preview.
 *
 * @module dsh-officebench-plugin/client/rpc
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { OfficeBenchRpcEndpoint, OfficeBenchRpcMap } from '../types.ts'

export const OFFICEBENCH_CHANNEL = '/officebench'

/** Error raised when an `/officebench` RPC endpoint returns a failure result. */
export class OfficeBenchClientError extends Error {
  override readonly name = 'OfficeBenchClientError'

  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Typed client facade for the Host `/officebench` RPC channel. */
export interface OfficeBenchClient {
  call<K extends OfficeBenchRpcEndpoint>(
    endpoint: K,
    payload: OfficeBenchRpcMap[K]['request'],
    signal?: AbortSignal,
  ): Promise<OfficeBenchRpcMap[K]['response']>
}

/** Create a typed client over the browser `ctx.connection` handle. */
export function createOfficeBenchClient(connection: ConnectionHandle): OfficeBenchClient {
  return {
    async call<K extends OfficeBenchRpcEndpoint>(
      endpoint: K,
      payload: OfficeBenchRpcMap[K]['request'],
      signal?: AbortSignal,
    ): Promise<OfficeBenchRpcMap[K]['response']> {
      const result = await connection.rpc.call(OFFICEBENCH_CHANNEL, endpoint, payload, signal)
      if (!result.ok) {
        throw new OfficeBenchClientError(result.error.code, result.error.message)
      }
      return result.value as OfficeBenchRpcMap[K]['response']
    },
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/**
 * Build the `dsh-resource://file/session/<sessionId>/<path>` URI consumed by
 * DSH's right-sidebar Document Preview (`ui-sidebar-documentpreview`).
 */
export function sessionFileAddress(sessionId: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/testbed\/?/, '').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
  const encodedPath = normalized.split('/').map(encodeSegment).join('/')
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodedPath}`
}

/** Resolve the active working directory of a Session from the Client Sessions snapshot. */
export function selectSessionCwd(
  sessions: {
    readonly byId: Readonly<Record<string, {
      readonly cwd?: string
      readonly projectionValues?: Readonly<Record<string, unknown>>
    } | undefined>>
  },
  sessionId: string,
): string | undefined {
  const summary = sessions.byId[sessionId]
  if (summary === undefined) return undefined
  const projected = summary.projectionValues?.workingDirectory
  if (typeof projected === 'string' && projected !== '') return projected
  return summary.cwd
}

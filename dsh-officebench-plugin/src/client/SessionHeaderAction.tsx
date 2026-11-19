/**
 * Compact Session-header pill rendered in `conversation.session.header.utilities`
 * only when the current Session is linked to an OfficeBench run. Clicking it
 * opens or reveals the right-sidebar OfficeBench Inspector tab.
 *
 * @module dsh-officebench-plugin/client/SessionHeaderAction
 */

import { useEffect, useState, type ReactElement } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeBenchRunRecord } from '../types.ts'
import { OfficeBenchIcon } from './icons.tsx'
import type { OfficeBenchLocaleKey } from './locales.ts'
import { selectSessionCwd, type OfficeBenchClient } from './rpc.ts'

export interface SessionHeaderInjected {
  readonly client: OfficeBenchClient
  readonly openInspector: () => void
  readonly hooks: {
    readonly evalRevision: HostObservable<number>
  }
}

export type SessionHeaderActionProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<SessionHeaderInjected>
  & PropsLocale<'officebench'>

export function SessionHeaderAction(props: SessionHeaderActionProps): ReactElement | null {
  const { sessionId, useSessions, client, openInspector, useEvalRevision, t } = props
  const tr = t as (key: OfficeBenchLocaleKey) => string
  const cwd = useSessions(sessions => selectSessionCwd(sessions, sessionId))
  const revision = useEvalRevision(rev => rev)
  const [run, setRun] = useState<OfficeBenchRunRecord | null>(null)

  useEffect(() => {
    let cancelled = false
    void client.call('runs/for-session', {
      sessionId,
      ...(cwd === undefined ? {} : { cwd }),
    })
      .then((res) => {
        if (!cancelled) setRun(res.run)
      })
      .catch(() => {
        if (!cancelled) setRun(null)
      })
    return () => { cancelled = true }
  }, [client, sessionId, cwd, revision])

  if (run === null) return null

  const evalReport = run.lastEvaluation
  const dotClass = evalReport === undefined
    ? 'ob-dot'
    : evalReport.passed
      ? 'ob-dot ob-dot-pass'
      : 'ob-dot ob-dot-fail'

  return (
    <button
      type="button"
      className="ob-header-pill"
      title={tr('header.tooltip')}
      onClick={openInspector}
      data-officebench-header-pill={run.taskKey}
    >
      <OfficeBenchIcon size={13} />
      <span>OB {run.taskKey}</span>
      <span className={dotClass} />
    </button>
  )
}

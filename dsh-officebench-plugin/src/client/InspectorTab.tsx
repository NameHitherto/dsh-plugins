/**
 * Right-sidebar per-session OfficeBench Inspector tab (`sidebar.right.pane.tab`).
 *
 * Displays the active session's OfficeBench task brief, live rule-by-rule
 * evaluation runner, testbed file diff & Document Preview launcher, Email inbox
 * viewer, Calendar viewer, `answer.txt` preview, and one-click testbed reset.
 *
 * @module dsh-officebench-plugin/client/InspectorTab
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionRunContextResponse } from '../types.ts'
import { CheckCircleIcon, CrossCircleIcon, OfficeBenchIcon, RefreshIcon } from './icons.tsx'
import type { OfficeBenchLocaleKey } from './locales.ts'
import { selectSessionCwd, sessionFileAddress, type OfficeBenchClient } from './rpc.ts'

export interface InspectorInjected {
  readonly client: OfficeBenchClient
  readonly openWorkbench: () => void
  readonly notifyEvaluation: (sessionId: string) => void
}

export type InspectorTabProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InspectorInjected
  & PropsLocale<'officebench'>

type InspectorSubTab = 'eval' | 'files' | 'emails' | 'calendar'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function InspectorTab(props: InspectorTabProps): ReactElement {
  const { sessionId, useTabInfo, useSessions, client, openWorkbench, notifyEvaluation, t } = props
  const tr = t as (key: OfficeBenchLocaleKey) => string
  const { tab, panel } = useTabInfo()
  const cwd = useSessions(sessions => selectSessionCwd(sessions, sessionId))

  const [context, setContext] = useState<SessionRunContextResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<InspectorSubTab>('eval')
  const [showRules, setShowRules] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await client.call('runs/for-session', {
        sessionId,
        ...(cwd === undefined ? {} : { cwd }),
      })
      setContext(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [client, sessionId, cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return tab.actions.bindCommands({ refresh: () => { void refresh() } })
  }, [tab.actions, refresh])

  const openFilePreview = useCallback((relativePath: string) => {
    const address = sessionFileAddress(sessionId, relativePath)
    if (panel.isFloating) {
      tab.actions.openResource(address)
    } else {
      tab.actions.openResource(address, { paneId: panel.id, preferNewPane: true })
    }
  }, [sessionId, panel.id, panel.isFloating, tab.actions])

  const handleEvaluate = useCallback(async () => {
    const runId = context?.run?.runId
    if (runId === undefined) return
    setEvaluating(true)
    setError(null)
    try {
      await client.call('runs/evaluate', { runId })
      await refresh()
      notifyEvaluation(sessionId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEvaluating(false)
    }
  }, [client, context?.run?.runId, refresh, notifyEvaluation, sessionId])

  const handleReset = useCallback(async () => {
    const runId = context?.run?.runId
    if (runId === undefined) return
    setResetting(true)
    setError(null)
    try {
      const updated = await client.call('runs/reset', { runId })
      setContext(updated)
      notifyEvaluation(sessionId)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setResetting(false)
    }
  }, [client, context?.run?.runId, notifyEvaluation, sessionId])

  if (loading && context === null) {
    return (
      <div className="ob-inspector">
        <div className="ob-empty">...</div>
      </div>
    )
  }

  if (context === null || context.run === null || context.overview === null) {
    return (
      <div className="ob-inspector" data-officebench-inspector="empty">
        <div className="ob-empty">
          <OfficeBenchIcon size={28} />
          <div style={{ fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
            {tr('inspector.noRunTitle')}
          </div>
          <div>{tr('inspector.noRunBody')}</div>
          <button type="button" className="ob-btn ob-btn-primary" onClick={openWorkbench}>
            {tr('action.openWorkbench')}
          </button>
        </div>
      </div>
    )
  }

  const { run, task, overview } = context
  const evaluation = run.lastEvaluation

  return (
    <div className="ob-inspector" data-officebench-inspector="active">
      <div className="ob-inspector-head">
        <div className="ob-inspector-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span className="ob-row-key" style={{ fontSize: 13 }}>{run.taskKey}</span>
            {evaluation === undefined ? (
              <span className="ob-badge">{tr('status.pending')}</span>
            ) : evaluation.passed ? (
              <span className="ob-badge ob-badge-pass">
                <CheckCircleIcon size={12} />
                {tr('status.pass')} {evaluation.passedCount}/{evaluation.totalCount}
              </span>
            ) : (
              <span className="ob-badge ob-badge-fail">
                <CrossCircleIcon size={12} />
                {tr('status.fail')} {evaluation.passedCount}/{evaluation.totalCount}
              </span>
            )}
          </div>
          <button
            type="button"
            className="ob-btn ob-btn-sm"
            onClick={() => { void refresh() }}
            disabled={loading}
          >
            <RefreshIcon size={12} />
            <span>{tr('action.refresh')}</span>
          </button>
        </div>

        <div className="ob-row-meta">
          <span>{run.username}</span>
          <span>·</span>
          <span>{run.date} ({run.weekday}) {run.time}</span>
        </div>

        <div className="ob-tabs-row">
          <button
            type="button"
            className="ob-btn ob-btn-primary ob-btn-sm"
            onClick={() => { void handleEvaluate() }}
            disabled={evaluating}
          >
            {evaluating ? tr('action.evaluating') : tr('action.evaluate')}
          </button>
          <button
            type="button"
            className="ob-btn ob-btn-sm"
            onClick={() => { void handleReset() }}
            disabled={resetting}
          >
            {resetting ? tr('action.resetting') : tr('action.reset')}
          </button>
          <button
            type="button"
            className="ob-btn ob-btn-sm"
            onClick={openWorkbench}
          >
            {tr('tab.tasks')}
          </button>
        </div>
      </div>

      <div className="ob-inspector-tabs">
        <button
          type="button"
          className={`ob-chip ${subTab === 'eval' ? 'ob-chip-active' : ''}`}
          onClick={() => { setSubTab('eval') }}
        >
          {tr('inspector.subtab.eval')}
        </button>
        <button
          type="button"
          className={`ob-chip ${subTab === 'files' ? 'ob-chip-active' : ''}`}
          onClick={() => { setSubTab('files') }}
        >
          {tr('inspector.subtab.files')} ({overview.changes.length}/{overview.files.length})
        </button>
        <button
          type="button"
          className={`ob-chip ${subTab === 'emails' ? 'ob-chip-active' : ''}`}
          onClick={() => { setSubTab('emails') }}
        >
          {tr('inspector.subtab.emails')} ({overview.emails.length})
        </button>
        <button
          type="button"
          className={`ob-chip ${subTab === 'calendar' ? 'ob-chip-active' : ''}`}
          onClick={() => { setSubTab('calendar') }}
        >
          {tr('inspector.subtab.calendar')} ({overview.calendarEvents.length})
        </button>
      </div>

      <div className="ob-inspector-body">
        {error !== null ? (
          <div className="ob-error-banner">{tr('error.prefix')} {error}</div>
        ) : null}

        <div className="ob-card">
          <div className="ob-card-title">{tr('detail.taskPrompt')}</div>
          <p className="ob-prompt-box">{run.task}</p>
        </div>

        {subTab === 'eval' ? (
          <>
            {evaluation !== undefined ? (
              <div className={`ob-verdict ${evaluation.passed ? 'ob-verdict-pass' : 'ob-verdict-fail'}`}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {evaluation.passed ? <CheckCircleIcon size={16} /> : <CrossCircleIcon size={16} />}
                  <span>
                    {evaluation.passed ? tr('status.pass') : tr('status.fail')} ({evaluation.passedCount}/{evaluation.totalCount})
                  </span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 400 }}>
                  {new Date(evaluation.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
            ) : (
              <div className="ob-card" style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
                {tr('inspector.evalHint')}
              </div>
            )}

            <div className="ob-card">
              <div className="ob-card-title">
                <span>{tr('detail.evalRules')} ({task?.evaluation.length ?? evaluation?.totalCount ?? 0})</span>
                <button
                  type="button"
                  className="ob-btn ob-btn-sm"
                  onClick={() => { setShowRules(prev => !prev) }}
                >
                  {showRules ? tr('detail.hideRules') : tr('detail.showRules')}
                </button>
              </div>
              {showRules ? (
                evaluation !== undefined ? (
                  evaluation.rules.map(rule => (
                    <div key={rule.index} className="ob-rule-item">
                      <div className={`ob-rule-head ${rule.passed ? 'ob-rule-pass' : 'ob-rule-fail'}`}>
                        {rule.passed ? <CheckCircleIcon size={14} /> : <CrossCircleIcon size={14} />}
                        <span>#{rule.index + 1}</span>
                        <span style={{ fontFamily: 'var(--ds-font-family-code)' }}>{rule.function}</span>
                      </div>
                      <div className="ob-rule-msg">{rule.message}</div>
                      <pre className="ob-rule-args">{JSON.stringify(rule.args, null, 2)}</pre>
                    </div>
                  ))
                ) : (
                  (task?.evaluation ?? []).map((rule, index) => (
                    <div key={`${rule.function}-${index}`} className="ob-rule-item">
                      <div className="ob-rule-head">
                        <span>#{index + 1}</span>
                        <span style={{ fontFamily: 'var(--ds-font-family-code)' }}>{rule.function}</span>
                      </div>
                      <pre className="ob-rule-args">{JSON.stringify(rule.args, null, 2)}</pre>
                    </div>
                  ))
                )
              ) : null}
            </div>
          </>
        ) : null}

        {subTab === 'files' ? (
          <>
            <div className="ob-card">
              <div className="ob-card-title">{tr('inspector.answer')}</div>
              {overview.answerText === null ? (
                <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
                  {tr('inspector.noAnswer')}
                </div>
              ) : (
                <pre className="ob-tool-pre">{overview.answerText}</pre>
              )}
            </div>

            <div className="ob-card">
              <div className="ob-card-title">
                <span>{tr('inspector.changes')} ({overview.changes.length})</span>
              </div>
              {overview.changes.length === 0 ? (
                <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
                  {tr('inspector.noChanges')}
                </div>
              ) : (
                <ul className="ob-file-list">
                  {overview.changes.map(change => (
                    <li key={change.relativePath} className="ob-file-item">
                      <span
                        className={`ob-badge ${
                          change.status === 'added'
                            ? 'ob-badge-pass'
                            : change.status === 'deleted'
                              ? 'ob-badge-fail'
                              : 'ob-badge-warn'
                        }`}
                      >
                        {change.status === 'added'
                          ? tr('change.added')
                          : change.status === 'deleted'
                            ? tr('change.deleted')
                            : tr('change.modified')}
                      </span>
                      <span className="ob-file-path">/testbed/{change.relativePath}</span>
                      {change.status !== 'deleted' ? (
                        <button
                          type="button"
                          className="ob-btn ob-btn-sm"
                          onClick={() => { openFilePreview(change.relativePath) }}
                        >
                          {tr('inspector.openPreview')}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ob-card">
              <div className="ob-card-title">
                <span>{tr('inspector.allFiles')} ({overview.files.length})</span>
              </div>
              <ul className="ob-file-list">
                {overview.files.map(file => (
                  <li key={file.relativePath} className="ob-file-item">
                    <span className="ob-file-path">/testbed/{file.relativePath}</span>
                    <span className="ob-badge">{formatBytes(file.sizeBytes)}</span>
                    <button
                      type="button"
                      className="ob-btn ob-btn-sm"
                      onClick={() => { openFilePreview(file.relativePath) }}
                    >
                      {tr('inspector.openPreview')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        {subTab === 'emails' ? (
          overview.emails.length === 0 ? (
            <div className="ob-empty">{tr('inspector.noEmails')}</div>
          ) : (
            overview.emails.map(email => (
              <div key={email.relativePath} className="ob-card">
                <div className="ob-row-head" style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{email.subject || email.emailId}</span>
                  <span className="ob-badge ob-badge-accent">{email.account}</span>
                </div>
                <div className="ob-row-meta" style={{ marginBottom: 6 }}>
                  <span>From: {email.from}</span>
                  <span>→</span>
                  <span>To: {email.to}</span>
                </div>
                <pre className="ob-tool-pre">{email.content}</pre>
              </div>
            ))
          )
        ) : null}

        {subTab === 'calendar' ? (
          overview.calendarEvents.length === 0 ? (
            <div className="ob-empty">{tr('inspector.noEvents')}</div>
          ) : (
            overview.calendarEvents.map((event, idx) => (
              <div key={`${event.relativePath}-${idx}`} className="ob-card">
                <div className="ob-row-head" style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{event.summary}</span>
                  <span className="ob-badge ob-badge-accent">{event.username}</span>
                </div>
                <div className="ob-row-meta" style={{ marginBottom: 4 }}>
                  <span>{event.timeStart} – {event.timeEnd}</span>
                  {event.location !== '' ? <span>· {event.location}</span> : null}
                </div>
                {event.description !== '' ? (
                  <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                    {event.description}
                  </div>
                ) : null}
              </div>
            ))
          )
        ) : null}
      </div>
    </div>
  )
}

/** Tab chip title for the right-sidebar OfficeBench Inspector. */
export function InspectorTabTitle({ t }: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'officebench'>): ReactElement {
  const tr = t as (key: OfficeBenchLocaleKey) => string
  return (
    <span className="ob-tab-title">
      <OfficeBenchIcon size={14} />
      <span>{tr('inspector.tabTitle')}</span>
    </span>
  )
}

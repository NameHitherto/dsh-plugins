/**
 * Main OfficeBench Workbench panel (left sidebar -> main slot):
 * - Configure/verify local OfficeBench dataset directory
 * - Browse, filter (1/2/3 apps, app tags), and search all 300 subtasks
 * - Inspect task prompt, virtual context, initial files, and evaluation rules
 * - One-click launch isolated PTC sessions ("Launch & run" or "Open draft")
 * - Manage past debug runs (open session, evaluate, reset, delete)
 *
 * @module dsh-officebench-plugin/client/WorkbenchPage
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  OfficeBenchAppTag,
  OfficeBenchRunRecord,
  OfficeBenchStatus,
  OfficeBenchTaskDetail,
  OfficeBenchTaskSummary,
} from '../types.ts'
import { CheckCircleIcon, CrossCircleIcon, OfficeBenchIcon, PlayIcon, RefreshIcon } from './icons.tsx'
import type { OfficeBenchLocaleKey } from './locales.ts'
import type { OfficeBenchClient } from './rpc.ts'

export interface WorkbenchInjected {
  readonly client: OfficeBenchClient
  readonly launchTask: (taskKey: string, mode: 'run' | 'draft') => Promise<void>
  readonly openRunSession: (run: OfficeBenchRunRecord) => void
}

export type WorkbenchPageProps =
  & PropsRuntime<'main'>
  & WorkbenchInjected
  & PropsLocale<'officebench'>

const APP_TAGS: readonly OfficeBenchAppTag[] = ['excel', 'word', 'pdf', 'ocr', 'email', 'calendar']

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WorkbenchPage({ client, launchTask, openRunSession, t }: WorkbenchPageProps): ReactElement {
  const tr = t as (key: OfficeBenchLocaleKey) => string

  const [activeTab, setActiveTab] = useState<'tasks' | 'runs'>('tasks')
  const [status, setStatus] = useState<OfficeBenchStatus | null>(null)
  const [datasetInput, setDatasetInput] = useState('')
  const [savingDataset, setSavingDataset] = useState(false)

  const [tasks, setTasks] = useState<readonly OfficeBenchTaskSummary[]>([])
  const [runs, setRuns] = useState<readonly OfficeBenchRunRecord[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [appCountFilter, setAppCountFilter] = useState<number | undefined>(undefined)
  const [appTagFilter, setAppTagFilter] = useState<OfficeBenchAppTag | undefined>(undefined)
  const [search, setSearch] = useState('')

  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<OfficeBenchTaskDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showRules, setShowRules] = useState(true)
  const [launchingMode, setLaunchingMode] = useState<'run' | 'draft' | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)

  const refreshAll = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const [tasksRes, runsRes] = await Promise.all([
        client.call('tasks/list', {}),
        client.call('runs/list', {}),
      ])
      setStatus(tasksRes.status)
      setDatasetInput(prev => (prev === '' ? tasksRes.status.datasetDir : prev))
      setTasks(tasksRes.tasks)
      setRuns(runsRes.runs)
      setSelectedTaskKey(prev => {
        if (prev !== null && tasksRes.tasks.some(item => item.key === prev)) return prev
        return tasksRes.tasks[0]?.key ?? null
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingList(false)
    }
  }, [client])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (selectedTaskKey === null || status?.datasetValid !== true) {
      setTaskDetail(null)
      return
    }
    let cancelled = false
    setLoadingDetail(true)
    void client.call('tasks/get', { taskKey: selectedTaskKey })
      .then((res) => {
        if (!cancelled) setTaskDetail(res.task)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => { cancelled = true }
  }, [client, selectedTaskKey, status?.datasetValid])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((item) => {
      if (appCountFilter !== undefined && item.appCount !== appCountFilter) return false
      if (appTagFilter !== undefined && !item.appTags.includes(appTagFilter)) return false
      if (q !== '') {
        const hay = `${item.key} ${item.task} ${item.username} ${item.appTags.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, appCountFilter, appTagFilter, search])

  const handleApplyDataset = useCallback(async () => {
    setSavingDataset(true)
    setError(null)
    try {
      const nextStatus = await client.call('config/set-dataset-dir', { datasetDir: datasetInput })
      setStatus(nextStatus)
      setDatasetInput(nextStatus.datasetDir)
      await refreshAll()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingDataset(false)
    }
  }, [client, datasetInput, refreshAll])

  const handleLaunch = useCallback(async (mode: 'run' | 'draft') => {
    if (selectedTaskKey === null) return
    setLaunchingMode(mode)
    setError(null)
    try {
      await launchTask(selectedTaskKey, mode)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLaunchingMode(null)
    }
  }, [launchTask, selectedTaskKey])

  const handleEvaluateRun = useCallback(async (runId: string) => {
    setBusyRunId(runId)
    setError(null)
    try {
      const res = await client.call('runs/evaluate', { runId })
      setRuns(prev => prev.map(item => (item.runId === runId ? res.run : item)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRunId(null)
    }
  }, [client])

  const handleResetRun = useCallback(async (runId: string) => {
    setBusyRunId(runId)
    setError(null)
    try {
      const res = await client.call('runs/reset', { runId })
      if (res.run !== null) {
        setRuns(prev => prev.map(item => (item.runId === runId ? res.run! : item)))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRunId(null)
    }
  }, [client])

  const handleDeleteRun = useCallback(async (runId: string) => {
    setBusyRunId(runId)
    setError(null)
    try {
      await client.call('runs/delete', { runId })
      setRuns(prev => prev.filter(item => item.runId !== runId))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRunId(null)
    }
  }, [client])

  return (
    <div className="ob-page" data-officebench-workbench="">
      <div className="ob-header">
        <div className="ob-header-title-group">
          <h1 className="ob-header-title">
            <OfficeBenchIcon size={20} />
            <span>{tr('page.title')}</span>
            {status?.datasetValid === true ? (
              <span className="ob-badge ob-badge-accent">
                {status.taskCount} {tr('dataset.valid')}
              </span>
            ) : (
              <span className="ob-badge ob-badge-warn">{tr('dataset.invalid')}</span>
            )}
          </h1>
          <p className="ob-header-subtitle">{tr('page.subtitle')}</p>
        </div>

        <div className="ob-caps">
          {status !== null ? (
            <>
              <span className={`ob-badge ${status.capabilities.libreOffice ? 'ob-badge-pass' : ''}`}>
                {tr('cap.libreoffice')}: {status.capabilities.libreOffice ? 'OK' : tr('cap.fallback')}
              </span>
              <span className={`ob-badge ${status.capabilities.tesseractCli ? 'ob-badge-pass' : ''}`}>
                {tr('cap.tesseract')}: {status.capabilities.tesseractCli ? 'OK' : 'tesseract.js'}
              </span>
              <span className={`ob-badge ${status.capabilities.pythonPyMuPdf ? 'ob-badge-pass' : ''}`}>
                {tr('cap.pymupdf')}: {status.capabilities.pythonPyMuPdf ? 'OK' : 'N/A'}
              </span>
            </>
          ) : null}
          <button type="button" className="ob-btn ob-btn-sm" onClick={() => { void refreshAll() }} disabled={loadingList}>
            <RefreshIcon size={13} />
            <span>{tr('action.refresh')}</span>
          </button>
        </div>
      </div>

      <div className="ob-dataset-bar">
        <span className="ob-dataset-label">{tr('dataset.label')}:</span>
        <input
          type="text"
          className="ob-input"
          value={datasetInput}
          placeholder={tr('dataset.placeholder')}
          onChange={event => { setDatasetInput(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') void handleApplyDataset() }}
        />
        <button
          type="button"
          className="ob-btn ob-btn-primary ob-btn-sm"
          onClick={() => { void handleApplyDataset() }}
          disabled={savingDataset}
        >
          {savingDataset ? tr('dataset.applying') : tr('dataset.apply')}
        </button>
      </div>

      {error !== null ? (
        <div style={{ padding: '8px 28px 0' }}>
          <div className="ob-error-banner">{tr('error.prefix')} {error}</div>
        </div>
      ) : null}

      <div className="ob-split">
        <div className="ob-list-pane">
          <div className="ob-toolbar">
            <div className="ob-tabs-row">
              <button
                type="button"
                className={`ob-chip ${activeTab === 'tasks' ? 'ob-chip-active' : ''}`}
                onClick={() => { setActiveTab('tasks') }}
              >
                {tr('tab.tasks')} ({filteredTasks.length})
              </button>
              <button
                type="button"
                className={`ob-chip ${activeTab === 'runs' ? 'ob-chip-active' : ''}`}
                onClick={() => { setActiveTab('runs') }}
              >
                {tr('tab.runs')} ({runs.length})
              </button>
            </div>

            {activeTab === 'tasks' ? (
              <>
                <input
                  type="search"
                  className="ob-input"
                  value={search}
                  placeholder={tr('search.placeholder')}
                  onChange={event => { setSearch(event.target.value) }}
                />
                <div className="ob-tabs-row">
                  <button
                    type="button"
                    className={`ob-chip ${appCountFilter === undefined ? 'ob-chip-active' : ''}`}
                    onClick={() => { setAppCountFilter(undefined) }}
                  >
                    {tr('filter.all')}
                  </button>
                  <button
                    type="button"
                    className={`ob-chip ${appCountFilter === 1 ? 'ob-chip-active' : ''}`}
                    onClick={() => { setAppCountFilter(1) }}
                  >
                    {tr('filter.1app')}
                  </button>
                  <button
                    type="button"
                    className={`ob-chip ${appCountFilter === 2 ? 'ob-chip-active' : ''}`}
                    onClick={() => { setAppCountFilter(2) }}
                  >
                    {tr('filter.2apps')}
                  </button>
                  <button
                    type="button"
                    className={`ob-chip ${appCountFilter === 3 ? 'ob-chip-active' : ''}`}
                    onClick={() => { setAppCountFilter(3) }}
                  >
                    {tr('filter.3apps')}
                  </button>
                </div>
                <div className="ob-tabs-row">
                  {APP_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      className={`ob-chip ${appTagFilter === tag ? 'ob-chip-active' : ''}`}
                      onClick={() => { setAppTagFilter(prev => (prev === tag ? undefined : tag)) }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="ob-scroll">
            {activeTab === 'tasks' ? (
              status?.datasetValid !== true ? (
                <div className="ob-empty">
                  <OfficeBenchIcon size={28} />
                  <div>{status?.datasetError ?? tr('dataset.hint')}</div>
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="ob-empty">{tr('detail.selectPrompt')}</div>
              ) : (
                filteredTasks.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    className={`ob-row ${selectedTaskKey === item.key ? 'ob-row-selected' : ''}`}
                    onClick={() => { setSelectedTaskKey(item.key) }}
                  >
                    <div className="ob-row-head">
                      <span className="ob-row-key">{item.key}</span>
                      <span className="ob-row-meta">
                        {item.appTags.map(tag => (
                          <span key={tag} className="ob-badge">{tag}</span>
                        ))}
                      </span>
                    </div>
                    <div className="ob-row-prompt">{item.task}</div>
                    <div className="ob-row-meta">
                      <span>{item.username}</span>
                      <span>·</span>
                      <span>{item.date} {item.time}</span>
                      <span>·</span>
                      <span>{item.fileCount} files</span>
                      <span>·</span>
                      <span>{item.evaluationCount} rules</span>
                    </div>
                  </button>
                ))
              )
            ) : runs.length === 0 ? (
              <div className="ob-empty">{tr('runs.empty')}</div>
            ) : (
              runs.map(run => {
                const evalReport = run.lastEvaluation
                const isBusy = busyRunId === run.runId
                return (
                  <div key={run.runId} className="ob-card" style={{ marginBottom: 8 }}>
                    <div className="ob-row-head" style={{ marginBottom: 4 }}>
                      <span className="ob-row-key">{run.taskKey}</span>
                      {evalReport === undefined ? (
                        <span className="ob-badge">{tr('status.pending')}</span>
                      ) : evalReport.passed ? (
                        <span className="ob-badge ob-badge-pass">
                          <CheckCircleIcon size={12} />
                          {tr('status.pass')} {evalReport.passedCount}/{evalReport.totalCount}
                        </span>
                      ) : (
                        <span className="ob-badge ob-badge-fail">
                          <CrossCircleIcon size={12} />
                          {tr('status.fail')} {evalReport.passedCount}/{evalReport.totalCount}
                        </span>
                      )}
                    </div>
                    <div className="ob-row-prompt" style={{ marginBottom: 6 }}>{run.task}</div>
                    <div className="ob-row-meta" style={{ marginBottom: 8 }}>
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                      <span>·</span>
                      <span>{run.sessionId ?? tr('runs.unbound')}</span>
                    </div>
                    <div className="ob-tabs-row">
                      {run.sessionId !== undefined ? (
                        <button
                          type="button"
                          className="ob-btn ob-btn-primary ob-btn-sm"
                          onClick={() => { openRunSession(run) }}
                        >
                          {tr('action.openSession')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ob-btn ob-btn-sm"
                        disabled={isBusy}
                        onClick={() => { void handleEvaluateRun(run.runId) }}
                      >
                        {tr('action.evaluate')}
                      </button>
                      <button
                        type="button"
                        className="ob-btn ob-btn-sm"
                        disabled={isBusy}
                        onClick={() => { void handleResetRun(run.runId) }}
                      >
                        {tr('action.reset')}
                      </button>
                      <button
                        type="button"
                        className="ob-btn ob-btn-danger ob-btn-sm"
                        disabled={isBusy}
                        onClick={() => { void handleDeleteRun(run.runId) }}
                      >
                        {tr('action.delete')}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="ob-detail-pane">
          {loadingDetail ? (
            <div className="ob-empty">...</div>
          ) : taskDetail === null ? (
            <div className="ob-empty">{tr('detail.selectPrompt')}</div>
          ) : (
            <>
              <div className="ob-row-head" style={{ marginBottom: 6 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, fontFamily: 'var(--ds-font-family-code)' }}>
                  {taskDetail.key}
                </h2>
                <div className="ob-tabs-row">
                  {taskDetail.appTags.map(tag => (
                    <span key={tag} className="ob-badge ob-badge-accent">{tag}</span>
                  ))}
                </div>
              </div>

              <div className="ob-actions-bar">
                <button
                  type="button"
                  className="ob-btn ob-btn-primary"
                  disabled={launchingMode !== null}
                  onClick={() => { void handleLaunch('run') }}
                >
                  <PlayIcon size={13} />
                  <span>{launchingMode === 'run' ? tr('action.launching') : tr('action.launchRun')}</span>
                </button>
                <button
                  type="button"
                  className="ob-btn"
                  disabled={launchingMode !== null}
                  onClick={() => { void handleLaunch('draft') }}
                >
                  <span>{launchingMode === 'draft' ? tr('action.launching') : tr('action.launchDraft')}</span>
                </button>
              </div>

              <div className="ob-card">
                <div className="ob-card-title">{tr('detail.taskPrompt')}</div>
                <p className="ob-prompt-box">{taskDetail.task}</p>
              </div>

              <div className="ob-card">
                <div className="ob-card-title">{tr('detail.context')}</div>
                <div className="ob-kv-grid">
                  <div>
                    <div className="ob-kv-label">{tr('detail.user')}</div>
                    <div className="ob-kv-val">{taskDetail.username}</div>
                  </div>
                  <div>
                    <div className="ob-kv-label">{tr('detail.clock')}</div>
                    <div className="ob-kv-val">{taskDetail.date} ({taskDetail.weekday}) {taskDetail.time}</div>
                  </div>
                </div>
              </div>

              <div className="ob-card">
                <div className="ob-card-title">
                  <span>{tr('detail.initialFiles')} ({taskDetail.initialFiles.length})</span>
                </div>
                {taskDetail.initialFiles.length === 0 ? (
                  <div style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
                    {tr('detail.noFiles')}
                  </div>
                ) : (
                  <ul className="ob-file-list">
                    {taskDetail.initialFiles.map(file => (
                      <li key={file.relativePath} className="ob-file-item">
                        <span className="ob-file-path">/testbed/{file.relativePath}</span>
                        <span className="ob-badge">{formatBytes(file.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="ob-card">
                <div className="ob-card-title">
                  <span>{tr('detail.evalRules')} ({taskDetail.evaluation.length})</span>
                  <button
                    type="button"
                    className="ob-btn ob-btn-sm"
                    onClick={() => { setShowRules(prev => !prev) }}
                  >
                    {showRules ? tr('detail.hideRules') : tr('detail.showRules')}
                  </button>
                </div>
                {showRules ? (
                  taskDetail.evaluation.map((rule, index) => (
                    <div key={`${rule.function}-${index}`} className="ob-rule-item">
                      <div className="ob-rule-head">
                        <span>#{index + 1}</span>
                        <span style={{ fontFamily: 'var(--ds-font-family-code)' }}>{rule.function}</span>
                      </div>
                      <pre className="ob-rule-args">{JSON.stringify(rule.args, null, 2)}</pre>
                    </div>
                  ))
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

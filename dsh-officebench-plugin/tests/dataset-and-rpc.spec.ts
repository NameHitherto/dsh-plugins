import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { OfficeBenchManager } from '../src/dataset.ts'
import OfficeBenchPlugin, { OfficeBenchService } from '../src/index.ts'
import { calendarCreateEvent } from '../src/office/calendar.ts'
import { emailSendEmail } from '../src/office/email.ts'
import { excelCreateNewFile, excelSetCell } from '../src/office/excel.ts'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createSyntheticDataset(): Promise<{ datasetDir: string; runsDir: string }> {
  const root = await makeTempDir('dsh-ob-ds-')
  const datasetDir = join(root, 'OfficeBench')
  const runsDir = join(root, 'runs')

  // Task 1-1/0 (Excel)
  const task1Dir = join(datasetDir, 'tasks', '1-1')
  await mkdir(join(task1Dir, 'subtasks'), { recursive: true })
  await mkdir(join(task1Dir, 'testbed', 'data'), { recursive: true })
  await excelCreateNewFile(join(task1Dir, 'testbed'), 'data/scores.xlsx')
  await excelSetCell(join(task1Dir, 'testbed'), 'data/scores.xlsx', 1, 1, 'Student')
  await excelSetCell(join(task1Dir, 'testbed'), 'data/scores.xlsx', 1, 2, 'Score')
  await excelSetCell(join(task1Dir, 'testbed'), 'data/scores.xlsx', 2, 1, 'Alice')
  await excelSetCell(join(task1Dir, 'testbed'), 'data/scores.xlsx', 2, 2, '80')
  await writeFile(
    join(task1Dir, 'subtasks', '0.json'),
    JSON.stringify({
      username: 'Bob',
      date: '2020-05-01',
      weekday: 'Friday',
      time: '09:30:00',
      task: 'Update Alice score in /testbed/data/scores.xlsx to 95 and write 95 into /testbed/data/answer.txt.',
      evaluation: [
        {
          function: 'evaluate_excel_cell_value',
          args: { file: 'data/scores.xlsx', matches: [{ row: '2', col: '2', value: '95' }] },
        },
        {
          function: 'evaluate_contain',
          args: { doc_type: 'txt', file: 'data/answer.txt', keywords: ['95'] },
        },
      ],
    }, null, 2),
    'utf8',
  )

  // Task 2-1/0 (Email + Calendar)
  const task2Dir = join(datasetDir, 'tasks', '2-1')
  await mkdir(join(task2Dir, 'subtasks'), { recursive: true })
  await mkdir(join(task2Dir, 'testbed', 'emails'), { recursive: true })
  await mkdir(join(task2Dir, 'testbed', 'calendar'), { recursive: true })
  await emailSendEmail(join(task2Dir, 'testbed'), 'Alice', 'Bob', 'Meeting Request', 'Let us meet tomorrow at 10am.')
  await calendarCreateEvent(join(task2Dir, 'testbed'), 'Bob', 'Morning Sync', '2020-05-02 09:00:00', '2020-05-02 09:30:00')
  await writeFile(
    join(task2Dir, 'subtasks', '0.json'),
    JSON.stringify({
      username: 'Bob',
      date: '2020-05-01',
      weekday: 'Friday',
      time: '14:00:00',
      task: 'Read Alice email and schedule a meeting with Alice on 2020-05-02 10:00:00 to 11:00:00 with no overlaps.',
      evaluation: [
        { function: 'evaluate_calendar_no_overlap', args: { username: 'Bob' } },
        { function: 'evaluate_contain', args: { doc_type: 'ics', file: 'calendar/Bob.ics', keywords: ['Alice'] } },
      ],
    }, null, 2),
    'utf8',
  )

  return { datasetDir, runsDir }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('resolveConfig', () => {
  it('applies valid defaults and rejects invalid bounds', () => {
    const cfg = resolveConfig({ datasetDir: '/tmp/ob', runsDir: '/tmp/runs' })
    expect(cfg.datasetDir).toBe(resolve('/tmp/ob'))
    expect(cfg.runsDir).toBe(resolve('/tmp/runs'))
    expect(cfg.registerToolsGlobally).toBe(false)
    expect(cfg.shellTimeoutMs).toBe(30_000)
    expect(cfg.ocrLanguage).toBe('eng')

    expect(() => resolveConfig({ shellTimeoutMs: 500 })).toThrow(/shellTimeoutMs/)
    expect(() => resolveConfig({ ocrLanguage: '   ' })).toThrow(/ocrLanguage/)
  })
})

describe('OfficeBenchManager lifecycle', () => {
  it('scans tasks, filters, creates isolated runs, detects file diffs, evaluates, resets, and persists settings', async () => {
    const { datasetDir, runsDir } = await createSyntheticDataset()
    const manager = new OfficeBenchManager({
      datasetDir,
      runsDir,
      registerToolsGlobally: false,
      shellTimeoutMs: 30_000,
      ocrLanguage: 'eng',
    })
    await manager.initialize()

    const all = await manager.listTasks()
    expect(all.tasks).toHaveLength(2)
    expect(all.tasks.map(t => t.key)).toEqual(['1-1/0', '2-1/0'])

    const onlyTwoApp = await manager.listTasks({ appCount: 2 })
    expect(onlyTwoApp.tasks).toHaveLength(1)
    expect(onlyTwoApp.tasks[0]?.key).toBe('2-1/0')

    const bySearch = await manager.listTasks({ search: 'Alice score' })
    expect(bySearch.tasks).toHaveLength(1)
    expect(bySearch.tasks[0]?.key).toBe('1-1/0')

    // Create isolated run for 1-1/0
    const created = await manager.createRun('1-1/0')
    expect(created.run.taskKey).toBe('1-1/0')
    expect(created.suggestedPrompt).toContain('Update Alice score')

    // Bind to a session & look up by sessionId and by cwd
    const bound = await manager.bindSession(created.run.runId, 'sess-123')
    expect(bound.sessionId).toBe('sess-123')
    expect((await manager.findRunForSession('sess-123'))?.runId).toBe(created.run.runId)
    expect((await manager.findRunForSession(undefined, created.run.testbedDir))?.runId).toBe(created.run.runId)

    // Evaluate before changes -> fail
    const { report: evalBefore } = await manager.evaluateRun(created.run.runId)
    expect(evalBefore.passed).toBe(false)
    expect(evalBefore.passedCount).toBe(0)

    // Mutate run testbed -> inspect diff -> evaluate -> pass
    await excelSetCell(created.run.testbedDir, 'data/scores.xlsx', 2, 2, '95')
    await writeFile(join(created.run.testbedDir, 'data', 'answer.txt'), '95\n', 'utf8')

    const inspected = await manager.inspectRun(created.run.runId)
    expect(inspected.overview?.answerText?.trim()).toBe('95')
    expect(inspected.overview?.changes.some(c => c.relativePath === 'data/answer.txt' && c.status === 'added')).toBe(true)
    expect(inspected.overview?.changes.some(c => c.relativePath === 'data/scores.xlsx' && c.status === 'modified')).toBe(true)

    const { report: evalAfter } = await manager.evaluateRun(created.run.runId)
    expect(evalAfter.passed).toBe(true)
    expect(evalAfter.passedCount).toBe(2)

    // Reset restores pristine testbed and clears lastEvaluation
    const afterReset = await manager.resetRun(created.run.runId)
    expect(afterReset.run?.lastEvaluation).toBeUndefined()
    expect(afterReset.overview?.changes).toHaveLength(0)
    expect(afterReset.overview?.answerText).toBeNull()

    // Persist datasetDir change and verify reload in a new manager instance
    const status = await manager.setDatasetDir(datasetDir)
    expect(status.datasetValid).toBe(true)
    expect(status.taskCount).toBe(2)

    const reloaded = new OfficeBenchManager({
      datasetDir: '',
      runsDir,
      registerToolsGlobally: false,
      shellTimeoutMs: 30_000,
      ocrLanguage: 'eng',
    })
    await reloaded.initialize()
    expect(reloaded.getDatasetDir()).toBe(datasetDir)

    // Delete run
    const deleted = await reloaded.deleteRun(created.run.runId)
    expect(deleted).toBe(true)
    expect(await reloaded.listRuns()).toHaveLength(0)
  })
})

describe('OfficeBenchService RPC protocol', () => {
  it('handles all 12 RPC endpoints cleanly and returns structured errors on bad requests', async () => {
    const { datasetDir, runsDir } = await createSyntheticDataset()
    const ctx = new Context()
    await ctx.plugin(OfficeBenchPlugin, { datasetDir, runsDir })
    try {
      const service = ctx.get('officebench') as OfficeBenchService
      expect(service).toBeInstanceOf(OfficeBenchService)

      const status = await service.handleRpc('status/get', {})
      expect(status.ok).toBe(true)

      const tasksRes = await service.handleRpc('tasks/list', { appTag: 'email' })
      expect(tasksRes.ok).toBe(true)
      if (tasksRes.ok) {
        expect((tasksRes.value as { tasks: unknown[] }).tasks).toHaveLength(1)
      }

      const taskRes = await service.handleRpc('tasks/get', { taskKey: '2-1/0' })
      expect(taskRes.ok).toBe(true)

      const createRes = await service.handleRpc('runs/create', { taskKey: '2-1/0' })
      expect(createRes.ok).toBe(true)
      const runId = createRes.ok ? (createRes.value as { run: { runId: string } }).run.runId : ''
      expect(runId).not.toBe('')

      const bindRes = await service.handleRpc('runs/bind-session', { runId, sessionId: 'session-abc' })
      expect(bindRes.ok).toBe(true)

      const forSession = await service.handleRpc('runs/for-session', { sessionId: 'session-abc' })
      expect(forSession.ok).toBe(true)
      if (forSession.ok) {
        const val = forSession.value as { run: { runId: string } | null; overview: { emails: unknown[]; calendarEvents: unknown[] } | null }
        expect(val.run?.runId).toBe(runId)
        expect(val.overview?.emails.length).toBe(2)
        expect(val.overview?.calendarEvents.length).toBe(1)
      }

      const evalRes = await service.handleRpc('runs/evaluate', { runId })
      expect(evalRes.ok).toBe(true)

      const resetRes = await service.handleRpc('runs/reset', { runId })
      expect(resetRes.ok).toBe(true)

      const deleteRes = await service.handleRpc('runs/delete', { runId })
      expect(deleteRes.ok).toBe(true)

      const badEndpoint = await service.handleRpc('unknown/endpoint', {})
      expect(badEndpoint.ok).toBe(false)
      if (!badEndpoint.ok) {
        expect(badEndpoint.error.code).toBe('officebench/unknown-endpoint')
      }

      const badPayload = await service.handleRpc('runs/create', { taskKey: '' })
      expect(badPayload.ok).toBe(false)
      if (!badPayload.ok) {
        expect(badPayload.error.code).toBe('OFFICEBENCH_BAD_REQUEST')
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

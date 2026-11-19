import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OfficeBenchManager } from '../src/dataset.ts'
import { evaluateTaskRules } from '../src/evaluator.ts'
import { calendarCreateEvent } from '../src/office/calendar.ts'
import { emailSendEmail } from '../src/office/email.ts'
import { excelCreateNewFile, excelSetCell } from '../src/office/excel.ts'
import { wordConvertToPdf, wordCreateNewFile, wordWriteToFile } from '../src/office/word.ts'
import type { OfficeBenchEvaluationRule } from '../src/types.ts'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('OfficeBench evaluator — all 9 evaluation functions', () => {
  it('evaluates evaluate_file_exist and evaluate_file_not_exist', async () => {
    const root = await makeTempDir('dsh-ob-eval-exist-')
    const testbed = join(root, 'testbed')
    await mkdir(join(testbed, 'data'), { recursive: true })
    await writeFile(join(testbed, 'data', 'present.txt'), 'ok', 'utf8')

    const rules: OfficeBenchEvaluationRule[] = [
      { function: 'evaluate_file_exist', args: { file: 'data/present.txt' } },
      { function: 'evaluate_file_not_exist', args: { file: 'data/removed.txt' } },
      { function: 'evaluate_file_exist', args: { file: 'data/missing.txt' } },
      { function: 'evaluate_file_not_exist', args: { file: 'data/present.txt' } },
    ]
    const report = await evaluateTaskRules(
      { runId: 'run-1', taskKey: '1-test/0', testbedDir: testbed, taskSourceDir: root },
      rules,
    )
    expect(report.passed).toBe(false)
    expect(report.passedCount).toBe(2)
    expect(report.totalCount).toBe(4)
    expect(report.rules.map(r => r.passed)).toEqual([true, true, false, false])
  })

  it('evaluates evaluate_contain and evaluate_not_contain across txt, xlsx, docx/doc, pdf, email, and ics', async () => {
    const root = await makeTempDir('dsh-ob-eval-contain-')
    const testbed = join(root, 'testbed')
    await mkdir(join(testbed, 'data'), { recursive: true })
    await writeFile(join(testbed, 'data', 'answer.txt'), 'Alice owes $320 to Bob.', 'utf8')

    await excelCreateNewFile(testbed, 'data/sheet.xlsx')
    await excelSetCell(testbed, 'data/sheet.xlsx', 1, 1, 'Quarter')
    await excelSetCell(testbed, 'data/sheet.xlsx', 1, 2, 'Q4-2020')

    await wordCreateNewFile(testbed, 'data/notes.docx')
    await wordWriteToFile(testbed, 'data/notes.docx', 'Project Apollo launch confirmed.')
    await wordConvertToPdf(testbed, 'data/notes.docx', 'data/notes.pdf')

    await emailSendEmail(testbed, 'Bob', 'Alice', 'Status Update', 'The final milestone is complete.')
    await calendarCreateEvent(testbed, 'Bob', 'Board Sync', '2020-05-06 09:00:00', '2020-05-06 10:00:00')

    const rules: OfficeBenchEvaluationRule[] = [
      { function: 'evaluate_contain', args: { doc_type: 'txt', file: 'data/answer.txt', keywords: ['alice', '$320'] } },
      { function: 'evaluate_not_contain', args: { doc_type: 'txt', file: 'data/answer.txt', keywords: ['charlie'] } },
      { function: 'evaluate_contain', args: { doc_type: 'xlsx', file: 'data/sheet.xlsx', keywords: ['q4-2020'] } },
      { function: 'evaluate_contain', args: { doc_type: 'doc', file: 'data/notes.docx', keywords: ['apollo'] } },
      { function: 'evaluate_contain', args: { doc_type: 'pdf', file: 'data/notes.pdf', keywords: ['apollo'] } },
      { function: 'evaluate_contain', args: { doc_type: 'email', username: 'Alice', keywords: ['milestone'] } },
      { function: 'evaluate_contain', args: { doc_type: 'ics', file: 'calendar/Bob.ics', keywords: ['board sync'] } },
    ]
    const report = await evaluateTaskRules(
      { runId: 'run-2', taskKey: '2-test/0', testbedDir: testbed, taskSourceDir: root },
      rules,
    )
    expect(report.passed).toBe(true)
    expect(report.passedCount).toBe(7)
  })

  it('evaluates evaluate_diff_contain_text with legacy ../../../../cache/ paths', async () => {
    const root = await makeTempDir('dsh-ob-eval-diff-')
    const taskDir = join(root, 'tasks', '1-7')
    const initialTestbed = join(taskDir, 'testbed')
    const runTestbed = join(root, 'runs', 'r1', 'testbed')
    await mkdir(join(initialTestbed, 'data'), { recursive: true })
    await mkdir(join(runTestbed, 'data'), { recursive: true })

    await wordCreateNewFile(initialTestbed, 'data/essay.docx')
    await wordWriteToFile(initialTestbed, 'data/essay.docx', 'Original paragraph.')

    await wordCreateNewFile(runTestbed, 'data/essay.docx')
    await wordWriteToFile(runTestbed, 'data/essay.docx', 'Original paragraph.')
    await wordWriteToFile(runTestbed, 'data/essay.docx', 'Newly appended conclusion with Alpha42.')

    const ctx = {
      runId: 'run-3',
      taskKey: '1-7/0',
      testbedDir: runTestbed,
      initialTestbedDir: initialTestbed,
      taskSourceDir: taskDir,
    }

    const passReport = await evaluateTaskRules(ctx, [
      {
        function: 'evaluate_diff_contain_text',
        args: {
          doc_type: 'doc',
          input_file: '../../../../cache/0/testbed/data/essay.docx',
          output_file: 'data/essay.docx',
          keywords: ['Alpha42'],
        },
      },
    ])
    expect(passReport.passed).toBe(true)

    const failReport = await evaluateTaskRules(ctx, [
      {
        function: 'evaluate_diff_contain_text',
        args: {
          doc_type: 'doc',
          input_file: '../../../../cache/0/testbed/data/essay.docx',
          output_file: 'data/essay.docx',
          keywords: ['Original paragraph'],
        },
      },
    ])
    expect(failReport.passed).toBe(false)
  })

  it('evaluates evaluate_excel_cell_value and evaluate_excel_cell_comparator', async () => {
    const root = await makeTempDir('dsh-ob-eval-excel-')
    const testbed = join(root, 'testbed')
    await mkdir(join(testbed, 'data'), { recursive: true })
    await excelCreateNewFile(testbed, 'data/scores.xlsx')
    await excelSetCell(testbed, 'data/scores.xlsx', 2, 2, '3')
    await excelSetCell(testbed, 'data/scores.xlsx', 2, 3, '95.5')

    const ctx = { runId: 'run-4', taskKey: '1-6/0', testbedDir: testbed, taskSourceDir: root }

    const passReport = await evaluateTaskRules(ctx, [
      {
        function: 'evaluate_excel_cell_value',
        args: {
          file: 'data/scores.xlsx',
          matches: [{ row: '2', col: '3', value: '95.5' }],
        },
      },
      {
        function: 'evaluate_excel_cell_comparator',
        args: {
          file: 'data/scores.xlsx',
          matches: [{ row: '2', col: '2', comparator: "lambda x: x in ['1', '2', '3', '4', '5']" }],
        },
      },
    ])
    expect(passReport.passed).toBe(true)

    const failReport = await evaluateTaskRules(ctx, [
      {
        function: 'evaluate_excel_cell_comparator',
        args: {
          file: 'data/scores.xlsx',
          matches: [{ row: '2', col: '2', comparator: "lambda x: x in ['8', '9']" }],
        },
      },
    ])
    expect(failReport.passed).toBe(false)
  })

  it('evaluates evaluate_exact_match with ../../../../reference/ xlsx files', async () => {
    const root = await makeTempDir('dsh-ob-eval-exact-')
    const refDir = join(root, 'reference')
    const testbed = join(root, 'testbed')
    await mkdir(refDir, { recursive: true })
    await mkdir(join(testbed, 'data'), { recursive: true })

    await excelCreateNewFile(refDir, 'gold.xlsx')
    await excelSetCell(refDir, 'gold.xlsx', 1, 1, 'Name')
    await excelSetCell(refDir, 'gold.xlsx', 1, 2, '42')

    await excelCreateNewFile(testbed, 'data/out.xlsx')
    await excelSetCell(testbed, 'data/out.xlsx', 1, 1, 'Name')
    await excelSetCell(testbed, 'data/out.xlsx', 1, 2, '42')

    const ctx = { runId: 'run-5', taskKey: '1-10/0', testbedDir: testbed, taskSourceDir: root }
    const rules: OfficeBenchEvaluationRule[] = [
      {
        function: 'evaluate_exact_match',
        args: {
          doc_type: 'xlsx',
          result_file: 'data/out.xlsx',
          expected_file: '../../../../reference/gold.xlsx',
        },
      },
    ]

    const passReport = await evaluateTaskRules(ctx, rules)
    expect(passReport.passed).toBe(true)

    await excelSetCell(testbed, 'data/out.xlsx', 1, 2, '99')
    const failReport = await evaluateTaskRules(ctx, rules)
    expect(failReport.passed).toBe(false)
  })

  it('evaluates evaluate_calendar_no_overlap for clean and conflicting schedules', async () => {
    const root = await makeTempDir('dsh-ob-eval-cal-')
    const testbed = join(root, 'testbed')
    await mkdir(join(testbed, 'calendar'), { recursive: true })

    await calendarCreateEvent(testbed, 'Bob', 'Standup', '2020-05-05 09:00:00', '2020-05-05 09:30:00')
    await calendarCreateEvent(testbed, 'Bob', 'Planning', '2020-05-05 10:00:00', '2020-05-05 11:00:00')

    const ctx = { runId: 'run-6', taskKey: '1-2/0', testbedDir: testbed, taskSourceDir: root }
    const rules: OfficeBenchEvaluationRule[] = [
      { function: 'evaluate_calendar_no_overlap', args: { username: 'Bob' } },
    ]

    const cleanReport = await evaluateTaskRules(ctx, rules)
    expect(cleanReport.passed).toBe(true)

    await calendarCreateEvent(testbed, 'Bob', 'Conflict', '2020-05-05 10:30:00', '2020-05-05 11:30:00')
    const conflictReport = await evaluateTaskRules(ctx, rules)
    expect(conflictReport.passed).toBe(false)
    expect(conflictReport.rules[0]?.message).toContain('Conflict')
  })
})

const REAL_OFFICEBENCH_DIR =
  [process.env.OFFICEBENCH_DIR, join(homedir(), 'research', 'OfficeBench'), 'D:\\Research\\EEG\\experiments\\OfficeBench'].find(
    (candidate): candidate is string => Boolean(candidate && existsSync(join(candidate, 'tasks'))),
  ) ?? join(homedir(), 'research', 'OfficeBench')

describe.skipIf(!existsSync(join(REAL_OFFICEBENCH_DIR, 'tasks')))(
  'Real OfficeBench dataset read-only smoke test',
  () => {
    it('indexes all 300 tasks and evaluates an isolated temporary run without mutating the dataset', async () => {
      const runsDir = await makeTempDir('dsh-ob-real-runs-')
      const manager = new OfficeBenchManager({
        datasetDir: REAL_OFFICEBENCH_DIR,
        runsDir,
        registerToolsGlobally: false,
        shellTimeoutMs: 30_000,
        ocrLanguage: 'eng',
      })
      await manager.initialize()

      const catalog = await manager.listTasks()
      expect(catalog.status.datasetValid).toBe(true)
      expect(catalog.status.taskCount).toBe(300)
      expect(catalog.tasks).toHaveLength(300)

      const task = await manager.getTask('1-1/0')
      expect(task.evaluation.length).toBeGreaterThan(0)

      const created = await manager.createRun('1-1/0')
      const { report: initialEval } = await manager.evaluateRun(created.run.runId)
      expect(initialEval.totalCount).toBe(task.evaluation.length)
      expect(initialEval.passed).toBe(false)
    })
  },
)

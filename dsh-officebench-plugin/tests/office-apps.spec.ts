import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  calendarCreateEvent,
  calendarDeleteEvent,
  calendarListEvents,
  findCalendarOverlaps,
  readCalendarFileHost,
} from '../src/office/calendar.ts'
import { emailListEmails, emailReadEmail, emailSendEmail } from '../src/office/email.ts'
import {
  excelConvertToPdf,
  excelCreateNewFile,
  excelDeleteCell,
  excelReadFile,
  excelSetCell,
} from '../src/office/excel.ts'
import { imageConvertToPdf, pdfConvertToWord, pdfReadFile } from '../src/office/pdf.ts'
import { runShellCommand } from '../src/office/shell.ts'
import {
  wordConvertToPdf,
  wordCreateNewFile,
  wordReadFile,
  wordWriteToFile,
} from '../src/office/word.ts'
import { OfficeBenchError, resolveTestbedPath } from '../src/path-resolver.ts'

const tempDirs: string[] = []

async function createTempTestbed(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ob-apps-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'data'), { recursive: true })
  await mkdir(join(dir, 'emails'), { recursive: true })
  await mkdir(join(dir, 'calendar'), { recursive: true })
  return dir
}

/** Build a valid minimal 1x1 red RGB PNG buffer with valid CRCs. */
function makeMinimalPng(): Buffer {
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const byte of buf) {
      c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const tag = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0)
    return Buffer.concat([len, tag, data, crcBuf])
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rawScanline = Buffer.from([0, 220, 40, 40])
  const idat = deflateSync(rawScanline)
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('resolveTestbedPath', () => {
  it('maps /testbed, /data, relative, and host paths inside testbedDir', async () => {
    const tb = await createTempTestbed()
    const a = resolveTestbedPath(tb, '/testbed/data/report.xlsx')
    const b = resolveTestbedPath(tb, '/data/report.xlsx')
    const c = resolveTestbedPath(tb, 'data/report.xlsx')
    const d = resolveTestbedPath(tb, join(tb, 'data', 'report.xlsx'))

    expect(a.relativePath).toBe('data/report.xlsx')
    expect(a.virtualPath).toBe('/testbed/data/report.xlsx')
    expect(b.hostPath).toBe(a.hostPath)
    expect(c.hostPath).toBe(a.hostPath)
    expect(d.hostPath).toBe(a.hostPath)
  })

  it('rejects paths escaping the testbed root', async () => {
    const tb = await createTempTestbed()
    expect(() => resolveTestbedPath(tb, '../outside.txt')).toThrowError(OfficeBenchError)
    expect(() => resolveTestbedPath(tb, '/testbed/../../secret.txt')).toThrowError(/outside the OfficeBench testbed/i)
    expect(() => resolveTestbedPath(tb, '/etc/passwd')).toThrowError(/outside the OfficeBench testbed/i)
  })
})

describe('Excel office tools', () => {
  it('creates, writes numeric and text cells, reads, deletes, and converts to PDF', async () => {
    const tb = await createTempTestbed()
    const created = await excelCreateNewFile(tb, '/testbed/data/budget.xlsx')
    expect(created.ok).toBe(true)

    await excelSetCell(tb, '/testbed/data/budget.xlsx', 1, 1, 'Item')
    await excelSetCell(tb, '/testbed/data/budget.xlsx', 1, 2, 'Cost')
    await excelSetCell(tb, '/testbed/data/budget.xlsx', 2, 1, 'Laptop')
    await excelSetCell(tb, '/testbed/data/budget.xlsx', 2, 2, '1250.5')
    await excelSetCell(tb, '/testbed/data/budget.xlsx', 3, 1, 'Temp')

    const delRes = await excelDeleteCell(tb, '/testbed/data/budget.xlsx', 3, 1)
    expect(delRes.ok).toBe(true)

    const read = await excelReadFile(tb, '/testbed/data/budget.xlsx')
    expect(read.sheets).toEqual(['Sheet'])
    expect(read.rows[0]).toEqual(['Item', 'Cost'])
    expect(read.rows[1]).toEqual(['Laptop', 1250.5])
    expect(read.formatted).toContain('Laptop')
    expect(read.formatted).toContain('1250.5')

    const pdf = await excelConvertToPdf(tb, '/testbed/data/budget.xlsx', '/testbed/data/budget.pdf')
    expect(pdf.ok).toBe(true)
    const pdfText = await pdfReadFile(tb, '/testbed/data/budget.pdf')
    expect(pdfText.text).toContain('Laptop')
    expect(pdfText.text).toContain('1250.5')
  })
})

describe('Word & PDF office tools', () => {
  it('creates a Word document, appends styled paragraphs, reads back, converts to PDF, and converts PDF back to Word', async () => {
    const tb = await createTempTestbed()
    await wordCreateNewFile(tb, '/testbed/data/memo.docx')
    await wordWriteToFile(tb, '/testbed/data/memo.docx', 'Quarterly Summary', 'title')
    await wordWriteToFile(tb, '/testbed/data/memo.docx', 'Key Metrics', 'subtitle')
    await wordWriteToFile(tb, '/testbed/data/memo.docx', 'Total revenue grew 18 percent in Q2.', 'pure-text')

    const doc = await wordReadFile(tb, '/testbed/data/memo.docx')
    expect(doc.paragraphs).toEqual([
      'Quarterly Summary',
      'Key Metrics',
      'Total revenue grew 18 percent in Q2.',
    ])

    const pdfOut = await wordConvertToPdf(tb, '/testbed/data/memo.docx', '/testbed/data/memo.pdf')
    expect(pdfOut.ok).toBe(true)
    const readPdf = await pdfReadFile(tb, '/testbed/data/memo.pdf')
    expect(readPdf.page_count).toBeGreaterThanOrEqual(1)
    expect(readPdf.text).toContain('Quarterly Summary')
    expect(readPdf.text).toContain('Total revenue grew 18 percent in Q2.')

    const backToWord = await pdfConvertToWord(tb, '/testbed/data/memo.pdf', '/testbed/data/memo-copy.docx')
    expect(backToWord.ok).toBe(true)
    const readCopy = await wordReadFile(tb, '/testbed/data/memo-copy.docx')
    expect(readCopy.text).toContain('Quarterly Summary')
  })

  it('converts a PNG image into a valid readable PDF', async () => {
    const tb = await createTempTestbed()
    const pngPath = join(tb, 'data', 'pixel.png')
    await writeFile(pngPath, makeMinimalPng())

    const converted = await imageConvertToPdf(tb, '/testbed/data/pixel.png', '/testbed/data/pixel.pdf')
    expect(converted.ok).toBe(true)
    expect(converted.width).toBe(1)
    expect(converted.height).toBe(1)

    const pdf = await pdfReadFile(tb, '/testbed/data/pixel.pdf')
    expect(pdf.page_count).toBe(1)
  })
})

describe('Email office tools', () => {
  it('sends, lists, and reads emails in both sender and recipient mailboxes', async () => {
    const tb = await createTempTestbed()
    const sent = await emailSendEmail(
      tb,
      'Alice',
      'Bob@example.com',
      'Budget Approval',
      'Please approve the Q3 budget of $42,000 by Friday.',
    )
    expect(sent.ok).toBe(true)
    expect(sent.recipient_file).toContain('/testbed/emails/Bob/')
    expect(sent.sender_file).toContain('/testbed/emails/Alice/')

    const bobList = await emailListEmails(tb, 'bob', 20)
    expect(bobList.emails).toHaveLength(1)
    const first = bobList.emails[0]
    expect(first).toBeDefined()
    expect(first?.subject).toBe('Budget Approval')
    expect(first?.from).toContain('Alice')

    const bobRead = await emailReadEmail(tb, 'Bob', first!.email_id)
    expect(bobRead.content).toContain('$42,000')
    expect(bobRead.to).toContain('Bob@example.com')
  })
})

describe('Calendar office tools', () => {
  it('creates, lists, detects overlaps, and deletes calendar events', async () => {
    const tb = await createTempTestbed()
    await calendarCreateEvent(tb, 'Bob', 'Design Review', '2020-05-05 10:00:00', '2020-05-05 11:00:00')
    await calendarCreateEvent(tb, 'Bob', 'Overlapping Sync', '2020-05-05 10:30:00', '2020-05-05 11:30:00')

    const listed = await calendarListEvents(tb, 'Bob')
    expect(listed.events).toHaveLength(2)

    const parsedBefore = await readCalendarFileHost(join(tb, 'calendar', 'Bob.ics'))
    const overlapsBefore = findCalendarOverlaps(parsedBefore)
    expect(overlapsBefore).toHaveLength(1)
    expect(overlapsBefore[0]?.first.summary).toBe('Design Review')
    expect(overlapsBefore[0]?.second.summary).toBe('Overlapping Sync')

    const deleted = await calendarDeleteEvent(tb, 'Bob', 'Overlapping Sync')
    expect(deleted.deleted).toBe(true)

    const listedAfter = await calendarListEvents(tb, 'Bob')
    expect(listedAfter.events).toHaveLength(1)
    expect(listedAfter.events[0]?.summary).toBe('Design Review')
    const parsedAfter = await readCalendarFileHost(join(tb, 'calendar', 'Bob.ics'))
    expect(findCalendarOverlaps(parsedAfter)).toHaveLength(0)
  })
})

describe('Shell command helper', () => {
  it('executes commands inside testbedDir and rewrites /testbed references', async () => {
    const tb = await createTempTestbed()
    await writeFile(join(tb, 'data', 'hello.txt'), 'OfficeBench Shell OK\n', 'utf8')

    const res = await runShellCommand(tb, 'cat /testbed/data/hello.txt', {
      timeoutMs: 15_000,
      maxOutputBytes: 65_536,
    })
    expect(res.exit_code).toBe(0)
    expect(res.stdout).toContain('OfficeBench Shell OK')
  })
})

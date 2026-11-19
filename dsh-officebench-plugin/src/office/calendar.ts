/**
 * Calendar (`.ics`) office operations implementing RFC 5545 parsing, serialization,
 * event creation/deletion, and overlap checks compatible with OfficeBench's
 * `/testbed/calendar/<username>.ics` format.
 *
 * @module dsh-officebench-plugin/office/calendar
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeSegment, OfficeBenchError } from '../path-resolver.ts'

/** One parsed iCalendar VEVENT record. */
export interface CalendarEventRecord {
  readonly summary: string
  readonly time_start: string
  readonly time_end: string
  readonly description: string
  readonly location: string
  readonly uid?: string
  readonly startMs: number
  readonly endMs: number
}

/** Result of listing calendar events. */
export interface CalendarListResult {
  readonly username: string
  readonly events: readonly {
    readonly summary: string
    readonly time_start: string
    readonly time_end: string
    readonly description: string
    readonly location: string
  }[]
  readonly formatted: string
}

/** Result of creating a calendar event. */
export interface CalendarCreateResult {
  readonly ok: true
  readonly user: string
  readonly summary: string
  readonly time_start: string
  readonly time_end: string
  readonly file_path: string
}

/** Result of deleting a calendar event. */
export interface CalendarDeleteResult {
  readonly ok: true
  readonly user: string
  readonly summary: string
  readonly deleted: boolean
  readonly file_path: string
}

const EMPTY_CALENDAR_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//OfficeBench Calendar//dsh-officebench-plugin//EN',
  'END:VCALENDAR',
  '',
].join('\r\n')

function unfoldIcsLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rawLines = normalized.split('\n')
  const unfolded: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1)
    } else {
      unfolded.push(line)
    }
  }
  return unfolded
}

function unescapeIcsValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function escapeIcsValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Parse an iCalendar DTSTART/DTEND value (`20240501T160000Z`, `20240501T160000`, `20240501`)
 * into a UTC millisecond timestamp and OfficeBench `%Y-%m-%d %H:%M:%S` formatted string.
 */
export function parseIcsTimestamp(rawValue: string): { readonly formatted: string; readonly ms: number } {
  const trimmed = rawValue.trim()
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(trimmed)
  if (dtMatch !== null) {
    const [, y, m, d, hh, mm, ss] = dtMatch
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    const hour = Number(hh)
    const minute = Number(mm)
    const second = Number(ss)
    const ms = Date.UTC(year, month - 1, day, hour, minute, second)
    return {
      formatted: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
      ms,
    }
  }
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed)
  if (dateMatch !== null) {
    const [, y, m, d] = dateMatch
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)
    return {
      formatted: `${y}-${m}-${d} 00:00:00`,
      ms,
    }
  }
  // Fallback for ISO-like timestamps if encountered.
  const fallbackMs = Date.parse(trimmed)
  if (!Number.isNaN(fallbackMs)) {
    const dt = new Date(fallbackMs)
    const formatted = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`
    return { formatted, ms: fallbackMs }
  }
  return { formatted: trimmed, ms: 0 }
}

/**
 * Parse OfficeBench's `%Y-%m-%d %H:%M:%S` time argument into an iCalendar `YYYYMMDDTHHMMSS`
 * timestamp and validate all components.
 */
export function parseOfficeBenchDateTime(value: string, field: string): {
  readonly ics: string
  readonly formatted: string
  readonly ms: number
} {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (match === null) {
    throw new OfficeBenchError(
      `Invalid ${field} "${value}": expected format "YYYY-MM-DD HH:MM:SS"`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? '0')

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) {
    throw new OfficeBenchError(
      `Invalid calendar date/time for ${field}: "${value}"`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }

  const y = String(year).padStart(4, '0')
  const m = pad2(month)
  const d = pad2(day)
  const hh = pad2(hour)
  const mm = pad2(minute)
  const ss = pad2(second)

  return {
    ics: `${y}${m}${d}T${hh}${mm}${ss}`,
    formatted: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
    ms: date.getTime(),
  }
}

/** Parse all VEVENT blocks from an `.ics` string. */
export function parseIcsEvents(icsText: string): CalendarEventRecord[] {
  const lines = unfoldIcsLines(icsText)
  const events: CalendarEventRecord[] = []
  let inEvent = false
  let fields: Record<string, string> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      fields = {}
      continue
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent) {
        const start = parseIcsTimestamp(fields.DTSTART ?? '')
        const end = parseIcsTimestamp(fields.DTEND ?? '')
        events.push({
          summary: unescapeIcsValue(fields.SUMMARY ?? ''),
          time_start: start.formatted,
          time_end: end.formatted,
          description: unescapeIcsValue(fields.DESCRIPTION ?? ''),
          location: unescapeIcsValue(fields.LOCATION ?? ''),
          ...(fields.UID === undefined ? {} : { uid: fields.UID }),
          startMs: start.ms,
          endMs: end.ms,
        })
      }
      inEvent = false
      continue
    }
    if (!inEvent) continue
    const colonIndex = line.indexOf(':')
    if (colonIndex < 0) continue
    const rawKey = line.slice(0, colonIndex)
    const propName = (rawKey.split(';')[0] ?? rawKey).trim().toUpperCase()
    const value = line.slice(colonIndex + 1)
    fields[propName] = value
  }

  return events
}

function serializeIcsCalendar(events: readonly CalendarEventRecord[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OfficeBench Calendar//dsh-officebench-plugin//EN',
  ]
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`

  for (const event of events) {
    const start = parseOfficeBenchDateTime(event.time_start, 'time_start')
    const end = parseOfficeBenchDateTime(event.time_end, 'time_end')
    lines.push('BEGIN:VEVENT')
    lines.push(`SUMMARY:${escapeIcsValue(event.summary)}`)
    lines.push(`DTSTART:${start.ics}`)
    lines.push(`DTEND:${end.ics}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`UID:${event.uid ?? `${randomUUID()}@officebench.local`}`)
    if (event.description !== '') {
      lines.push(`DESCRIPTION:${escapeIcsValue(event.description)}`)
    }
    if (event.location !== '') {
      lines.push(`LOCATION:${escapeIcsValue(event.location)}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR', '')
  return lines.join('\r\n')
}

/** Read and parse events from a user's calendar file on disk. */
export async function readCalendarFileHost(hostPath: string): Promise<CalendarEventRecord[]> {
  const text = await readFile(hostPath, 'utf8')
  return parseIcsEvents(text)
}

/** List all events from a user's calendar inside a run's testbed. */
export async function calendarListEvents(
  testbedDir: string,
  username: string,
): Promise<CalendarListResult> {
  const safeUser = assertSafeSegment(username, 'username')
  const calendarDir = join(testbedDir, 'calendar')
  await mkdir(calendarDir, { recursive: true })
  const calendarFile = join(calendarDir, `${safeUser}.ics`)
  if (!existsSync(calendarFile)) {
    await writeFile(calendarFile, EMPTY_CALENDAR_ICS, 'utf8')
  }

  const records = await readCalendarFileHost(calendarFile)
  const events = records.map(event => ({
    summary: event.summary,
    time_start: event.time_start,
    time_end: event.time_end,
    description: event.description,
    location: event.location,
  }))

  let formatted = ''
  for (const event of events) {
    formatted += `Summary: ${event.summary}\n`
    formatted += `Start Time: ${event.time_start}\n`
    formatted += `End Time: ${event.time_end}\n`
    formatted += `Description: ${event.description || 'None'}\n`
    formatted += `Location: ${event.location || 'None'}\n`
    formatted += `${'-'.repeat(50)}\n`
  }

  return {
    username: safeUser,
    events,
    formatted: formatted === '' ? `No events found for ${safeUser}.` : formatted.trim(),
  }
}

/** Add a new event to a user's calendar inside a run's testbed. */
export async function calendarCreateEvent(
  testbedDir: string,
  user: string,
  summary: string,
  timeStart: string,
  timeEnd: string,
  description = 'This is a test event',
  location = 'Online',
): Promise<CalendarCreateResult> {
  const safeUser = assertSafeSegment(user, 'user')
  const start = parseOfficeBenchDateTime(timeStart, 'time_start')
  const end = parseOfficeBenchDateTime(timeEnd, 'time_end')
  if (end.ms < start.ms) {
    throw new OfficeBenchError(
      `Invalid event interval: time_end (${end.formatted}) is earlier than time_start (${start.formatted})`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }

  const calendarDir = join(testbedDir, 'calendar')
  await mkdir(calendarDir, { recursive: true })
  const calendarFile = join(calendarDir, `${safeUser}.ics`)

  const existing = existsSync(calendarFile) ? await readCalendarFileHost(calendarFile) : []
  const next: CalendarEventRecord[] = [
    ...existing,
    {
      summary,
      time_start: start.formatted,
      time_end: end.formatted,
      description,
      location,
      uid: `${randomUUID()}@officebench.local`,
      startMs: start.ms,
      endMs: end.ms,
    },
  ]

  await writeFile(calendarFile, serializeIcsCalendar(next), 'utf8')
  return {
    ok: true,
    user: safeUser,
    summary,
    time_start: start.formatted,
    time_end: end.formatted,
    file_path: `/testbed/calendar/${safeUser}.ics`,
  }
}

/** Delete the first event matching `summary` from a user's calendar inside a run's testbed. */
export async function calendarDeleteEvent(
  testbedDir: string,
  user: string,
  summary: string,
): Promise<CalendarDeleteResult> {
  const safeUser = assertSafeSegment(user, 'user')
  const calendarFile = join(testbedDir, 'calendar', `${safeUser}.ics`)
  if (!existsSync(calendarFile)) {
    throw new OfficeBenchError(
      `Calendar file /testbed/calendar/${safeUser}.ics does not exist.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const existing = await readCalendarFileHost(calendarFile)
  const index = existing.findIndex(event => event.summary === summary)
  if (index < 0) {
    return {
      ok: true,
      user: safeUser,
      summary,
      deleted: false,
      file_path: `/testbed/calendar/${safeUser}.ics`,
    }
  }
  const updated = [...existing.slice(0, index), ...existing.slice(index + 1)]
  await writeFile(calendarFile, serializeIcsCalendar(updated), 'utf8')

  return {
    ok: true,
    user: safeUser,
    summary,
    deleted: true,
    file_path: `/testbed/calendar/${safeUser}.ics`,
  }
}

/** Check whether any two events in a calendar overlap (used by `evaluate_calendar_no_overlap`). */
export function findCalendarOverlaps(
  events: readonly CalendarEventRecord[],
): readonly { readonly first: CalendarEventRecord; readonly second: CalendarEventRecord }[] {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs)
  const overlaps: { readonly first: CalendarEventRecord; readonly second: CalendarEventRecord }[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!
    const next = sorted[i + 1]!
    if (current.endMs > next.startMs) {
      overlaps.push({ first: current, second: next })
    }
  }
  return overlaps
}

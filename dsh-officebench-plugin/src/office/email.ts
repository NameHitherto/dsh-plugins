/**
 * Email (`.eml`) office operations backed by `postal-mime` and RFC 822 serialization,
 * matching OfficeBench's `/testbed/emails/<username>/<subject>.eml` directory layout.
 *
 * @module dsh-officebench-plugin/office/email
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import PostalMime, { type Address } from 'postal-mime'
import { assertSafeSegment, OfficeBenchError, sanitizeEmailFilename } from '../path-resolver.ts'

/** Structured email record returned by list/read operations. */
export interface ParsedEmail {
  readonly email_id: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly content: string
  readonly preview: string
}

/** Result of listing emails for a user. */
export interface EmailListResult {
  readonly username: string
  readonly emails: readonly ParsedEmail[]
  readonly formatted: string
}

/** Result of reading a single email. */
export interface EmailReadResult {
  readonly username: string
  readonly email_id: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly content: string
}

/** Result of sending an email. */
export interface EmailSendResult {
  readonly ok: true
  readonly sender: string
  readonly recipient: string
  readonly subject: string
  readonly recipient_file: string
  readonly sender_file: string
}

function formatSingleAddress(entry: Address | undefined): string {
  if (entry === undefined) return ''
  if ('group' in entry && Array.isArray(entry.group)) {
    return entry.group
      .map(member => formatSingleAddress(member))
      .filter(Boolean)
      .join(', ')
  }
  const addr = entry.address ?? ''
  const name = entry.name?.trim() ?? ''
  if (name !== '' && addr !== '') return `${name} <${addr}>`
  return addr || name
}

function formatAddressList(entries: readonly Address[] | undefined): string {
  if (entries === undefined || entries.length === 0) return ''
  return entries
    .map(entry => formatSingleAddress(entry))
    .filter(Boolean)
    .join(', ')
}

/**
 * Parse a single `.eml` file from disk using `postal-mime`.
 *
 * @param hostPath - Absolute path to the `.eml` file.
 * @param emailId - File basename (`foo.eml`).
 * @param previewLength - Character limit for `preview` (`-1` for full content).
 */
export async function parseEmlFileHost(
  hostPath: string,
  emailId: string,
  previewLength = 20,
): Promise<ParsedEmail> {
  const raw = await readFile(hostPath)
  const parsed = await PostalMime.parse(raw)
  const from = formatSingleAddress(parsed.from)
  const to = formatAddressList(parsed.to)
  const subject = parsed.subject ?? ''
  const body = (parsed.text ?? parsed.html ?? '').replace(/\r\n/g, '\n')
  const preview = previewLength < 0 ? body : `${body.slice(0, previewLength)}...`

  return {
    email_id: emailId,
    from,
    to,
    subject,
    content: body,
    preview,
  }
}

/**
 * Resolve an email account folder inside `<testbedDir>/emails/` with case-insensitive
 * and substring fallback matching OfficeBench's `evaluate_contain(doc_type='email')`.
 */
export async function resolveEmailAccountFolder(
  testbedDir: string,
  username: string,
  options: { readonly createIfMissing?: boolean } = {},
): Promise<{ readonly account: string; readonly folderPath: string } | undefined> {
  const safeUser = assertSafeSegment(username.includes('@') ? (username.split('@')[0] ?? username) : username, 'username')
  const emailsRoot = join(testbedDir, 'emails')
  const exact = join(emailsRoot, safeUser)
  if (existsSync(exact)) {
    return { account: safeUser, folderPath: exact }
  }
  const lower = join(emailsRoot, safeUser.toLowerCase())
  if (existsSync(lower)) {
    return { account: safeUser.toLowerCase(), folderPath: lower }
  }
  if (existsSync(emailsRoot)) {
    const entries = await readdir(emailsRoot, { withFileTypes: true })
    const fuzzy = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase().includes(safeUser.toLowerCase()))
    if (fuzzy !== undefined) {
      return { account: fuzzy.name, folderPath: join(emailsRoot, fuzzy.name) }
    }
  }
  if (options.createIfMissing === true) {
    await mkdir(exact, { recursive: true })
    return { account: safeUser, folderPath: exact }
  }
  return undefined
}

/** List all `.eml` messages in a user's mailbox. */
export async function emailListEmails(
  testbedDir: string,
  username: string,
  firstNLetters = 20,
): Promise<EmailListResult> {
  const resolved = await resolveEmailAccountFolder(testbedDir, username, { createIfMissing: true })
  if (resolved === undefined) {
    return { username, emails: [], formatted: 'No emails found.' }
  }
  const entries = (await readdir(resolved.folderPath))
    .filter(name => name.toLowerCase().endsWith('.eml'))
    .sort((a, b) => a.localeCompare(b))

  const emails: ParsedEmail[] = []
  let formatted = ''
  for (const fileName of entries) {
    const parsed = await parseEmlFileHost(join(resolved.folderPath, fileName), fileName, firstNLetters)
    emails.push(parsed)
    formatted += `Email ID: ${parsed.email_id}\n`
    formatted += `From: ${parsed.from}\n`
    formatted += `To: ${parsed.to}\n`
    formatted += `Subject: ${parsed.subject}\n`
    formatted += `Content: ${firstNLetters < 0 ? parsed.content : parsed.preview}\n`
    formatted += `${'-'.repeat(50)}\n`
  }

  return {
    username: resolved.account,
    emails,
    formatted: formatted === '' ? 'No emails found.' : formatted,
  }
}

/** Read the full headers and content of one email by ID. */
export async function emailReadEmail(
  testbedDir: string,
  username: string,
  emailId: string,
): Promise<EmailReadResult> {
  const resolved = await resolveEmailAccountFolder(testbedDir, username, { createIfMissing: true })
  if (resolved === undefined) {
    throw new OfficeBenchError(
      `Failed to read email ${emailId} for ${username}: mailbox does not exist.`,
      'OFFICEBENCH_EMAIL_NOT_FOUND',
    )
  }
  const safeId = assertSafeSegment(emailId, 'email_id')
  const fileName = safeId.toLowerCase().endsWith('.eml') ? safeId : `${safeId}.eml`
  const filePath = join(resolved.folderPath, fileName)
  if (!existsSync(filePath)) {
    throw new OfficeBenchError(
      `Failed to read email ${fileName} for ${resolved.account}: file does not exist.`,
      'OFFICEBENCH_EMAIL_NOT_FOUND',
    )
  }
  const parsed = await parseEmlFileHost(filePath, fileName, -1)
  return {
    username: resolved.account,
    email_id: parsed.email_id,
    from: parsed.from,
    to: parsed.to,
    subject: parsed.subject,
    content: parsed.content,
  }
}

/** Send an email, persisting `.eml` files into both recipient and sender mailboxes. */
export async function emailSendEmail(
  testbedDir: string,
  sender: string,
  recipient: string,
  subject: string,
  content: string,
): Promise<EmailSendResult> {
  const senderAccount = assertSafeSegment(sender.includes('@') ? (sender.split('@')[0] ?? sender) : sender, 'sender')
  const recipientAccount = assertSafeSegment(
    recipient.includes('@') ? (recipient.split('@')[0] ?? recipient) : recipient,
    'recipient',
  )
  const recipientDir = join(testbedDir, 'emails', recipientAccount)
  const senderDir = join(testbedDir, 'emails', senderAccount)
  await mkdir(recipientDir, { recursive: true })
  await mkdir(senderDir, { recursive: true })

  const fileStem = sanitizeEmailFilename(subject)
  const fileName = `${fileStem}.eml`
  const rfc822 = [
    `From: ${senderAccount}@example.com`,
    `To: ${recipientAccount}@example.com`,
    `Subject: ${subject.replace(/\r?\n/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    content,
    '',
  ].join('\r\n')

  await writeFile(join(recipientDir, fileName), rfc822, 'utf8')
  await writeFile(join(senderDir, fileName), rfc822, 'utf8')

  return {
    ok: true,
    sender: senderAccount,
    recipient: recipientAccount,
    subject,
    recipient_file: `/testbed/emails/${recipientAccount}/${fileName}`,
    sender_file: `/testbed/emails/${senderAccount}/${fileName}`,
  }
}

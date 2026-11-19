/**
 * Word (`.docx`) office operations via OOXML (`jszip`), compatible with `python-docx`
 * paragraph extraction, creation, styled paragraph insertion, and PDF conversion.
 *
 * @module dsh-officebench-plugin/office/word
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import JSZip from 'jszip'
import { OfficeBenchError, resolveTestbedPath } from '../path-resolver.ts'
import { convertWithLibreOffice, findLibreOfficeBinary, renderTextLinesToPdf } from './excel.ts'

/** Paragraph style accepted by `word_write_to_file`. */
export type WordParagraphStyle = 'pure-text' | 'title' | 'subtitle'

/** Result of reading a Word document. */
export interface WordReadResult {
  readonly file_path: string
  readonly paragraphs: readonly string[]
  readonly text: string
}

/** Result of creating a Word document. */
export interface WordCreateResult {
  readonly ok: true
  readonly file_path: string
}

/** Result of appending text to a Word document. */
export interface WordWriteResult {
  readonly ok: true
  readonly file_path: string
  readonly style: WordParagraphStyle
  readonly paragraphs_added: number
}

/** Result of converting a Word document to PDF. */
export interface WordConvertPdfResult {
  readonly ok: true
  readonly word_file_path: string
  readonly pdf_file_path: string
  readonly engine: 'libreoffice' | 'pdf-lib-fallback'
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
</w:styles>`

const EMPTY_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:sectPr/>
  </w:body>
</w:document>`

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function buildParagraphXml(text: string, style: WordParagraphStyle): string {
  const styleTag = style === 'title'
    ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>'
    : style === 'subtitle'
      ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      : ''
  const lines = text.split(/\r?\n/)
  const runs = lines.map((line, index) => {
    const textNode = `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`
    return index === 0 ? `<w:r>${textNode}</w:r>` : `<w:r><w:br/>${textNode}</w:r>`
  }).join('')
  return `<w:p>${styleTag}${runs}</w:p>`
}

/**
 * Extract paragraphs from `word/document.xml`, matching `python-docx`'s `doc.paragraphs`.
 *
 * @param documentXml - Raw XML contents of `word/document.xml`.
 * @returns Ordered paragraph texts.
 */
export function extractDocxParagraphsFromXml(documentXml: string): string[] {
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(documentXml)
  const body = bodyMatch?.[1] ?? documentXml
  const paragraphs: string[] = []
  const paragraphPattern = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g

  let match: RegExpExecArray | null
  while ((match = paragraphPattern.exec(body)) !== null) {
    const inner = match[1]
    if (inner === undefined) {
      paragraphs.push('')
      continue
    }
    let paragraphText = ''
    const tokenPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g
    let token: RegExpExecArray | null
    while ((token = tokenPattern.exec(inner)) !== null) {
      if (token[1] !== undefined) {
        paragraphText += decodeXmlEntities(token[1])
      } else if (token[0].startsWith('<w:tab')) {
        paragraphText += '\t'
      } else {
        paragraphText += '\n'
      }
    }
    paragraphs.push(paragraphText)
  }

  return paragraphs
}

/**
 * Read paragraphs from a `.docx` file on disk.
 *
 * @param hostPath - Absolute path to the `.docx` file.
 * @returns Paragraph array and newline-joined string.
 */
export async function readDocxHost(hostPath: string): Promise<{
  readonly paragraphs: readonly string[]
  readonly text: string
}> {
  const bytes = await readFile(hostPath)
  const zip = await JSZip.loadAsync(bytes)
  const docFile = zip.file('word/document.xml')
  if (docFile === null) {
    throw new OfficeBenchError(
      `Invalid Word document "${hostPath}": missing word/document.xml`,
      'OFFICEBENCH_WORD_INVALID',
    )
  }
  const xml = await docFile.async('string')
  const paragraphs = extractDocxParagraphsFromXml(xml)
  return {
    paragraphs,
    text: paragraphs.join('\n'),
  }
}

/**
 * Create a new minimal OOXML `.docx` document at `hostPath`.
 */
export async function createDocxHost(hostPath: string): Promise<void> {
  await mkdir(dirname(hostPath), { recursive: true })
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML)
  zip.file('_rels/.rels', ROOT_RELS_XML)
  zip.file('word/document.xml', EMPTY_DOCUMENT_XML)
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML)
  zip.file('word/styles.xml', STYLES_XML)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(hostPath, buffer)
}

/**
 * Append a paragraph (or styled heading) to an existing `.docx` archive on disk.
 */
export async function appendDocxParagraphHost(
  hostPath: string,
  contents: string,
  style: WordParagraphStyle = 'pure-text',
): Promise<void> {
  const bytes = await readFile(hostPath)
  const zip = await JSZip.loadAsync(bytes)
  const docFile = zip.file('word/document.xml')
  if (docFile === null) {
    throw new OfficeBenchError(
      `Invalid Word document "${hostPath}": missing word/document.xml`,
      'OFFICEBENCH_WORD_INVALID',
    )
  }
  const xml = await docFile.async('string')
  const paragraphXml = buildParagraphXml(contents, style)
  let updated: string
  if (/<w:sectPr\b/.test(xml)) {
    updated = xml.replace(/<w:sectPr\b/, `${paragraphXml}<w:sectPr`)
  } else if (xml.includes('</w:body>')) {
    updated = xml.replace('</w:body>', `${paragraphXml}</w:body>`)
  } else {
    throw new OfficeBenchError(
      `Malformed word/document.xml in "${hostPath}": missing </w:body>`,
      'OFFICEBENCH_WORD_INVALID',
    )
  }
  zip.file('word/document.xml', updated)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(hostPath, buffer)
}

/** Create a new Word file inside a run's testbed. */
export async function wordCreateNewFile(
  testbedDir: string,
  filePath: string,
): Promise<WordCreateResult> {
  const resolved = resolveTestbedPath(testbedDir, filePath)
  await createDocxHost(resolved.hostPath)
  return { ok: true, file_path: resolved.virtualPath }
}

/** Read a Word file inside a run's testbed. */
export async function wordReadFile(
  testbedDir: string,
  filePath: string,
): Promise<WordReadResult> {
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to read the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }
  const data = await readDocxHost(resolved.hostPath)
  return {
    file_path: resolved.virtualPath,
    paragraphs: data.paragraphs,
    text: data.text,
  }
}

/** Append text to an existing Word file inside a run's testbed. */
export async function wordWriteToFile(
  testbedDir: string,
  filePath: string,
  contents: string,
  style: WordParagraphStyle = 'pure-text',
): Promise<WordWriteResult> {
  if (style !== 'pure-text' && style !== 'title' && style !== 'subtitle') {
    throw new OfficeBenchError(
      `Unsupported Word paragraph style "${String(style)}"; expected "pure-text", "title", or "subtitle"`,
      'OFFICEBENCH_INVALID_ARGUMENT',
    )
  }
  const resolved = resolveTestbedPath(testbedDir, filePath)
  if (!existsSync(resolved.hostPath)) {
    throw new OfficeBenchError(
      `The file ${resolved.virtualPath} does not exist. Failed to write to the file.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }
  await appendDocxParagraphHost(resolved.hostPath, contents, style)
  return {
    ok: true,
    file_path: resolved.virtualPath,
    style,
    paragraphs_added: 1,
  }
}

/** Convert a Word document inside a run's testbed to PDF (LibreOffice if installed, else `pdf-lib` fallback). */
export async function wordConvertToPdf(
  testbedDir: string,
  wordFilePath: string,
  pdfFilePath: string,
  options: { readonly libreOfficePath?: string; readonly signal?: AbortSignal } = {},
): Promise<WordConvertPdfResult> {
  const source = resolveTestbedPath(testbedDir, wordFilePath)
  const target = resolveTestbedPath(testbedDir, pdfFilePath)
  if (!existsSync(source.hostPath)) {
    throw new OfficeBenchError(
      `The word file ${source.virtualPath} does not exist. Failed to convert the file to pdf.`,
      'OFFICEBENCH_FILE_NOT_FOUND',
    )
  }

  const libreOffice = await findLibreOfficeBinary(options.libreOfficePath)
  if (libreOffice !== undefined) {
    try {
      await convertWithLibreOffice(libreOffice, source.hostPath, target.hostPath, options.signal)
      return {
        ok: true,
        word_file_path: source.virtualPath,
        pdf_file_path: target.virtualPath,
        engine: 'libreoffice',
      }
    } catch (_error: unknown) {
      // Fall back to pure-JS PDF rendering if LibreOffice fails.
    }
  }

  const data = await readDocxHost(source.hostPath)
  const lines = data.paragraphs.flatMap(paragraph => paragraph.split(/\r?\n/))
  await mkdir(dirname(target.hostPath), { recursive: true })
  const bytes = await renderTextLinesToPdf(lines)
  await writeFile(target.hostPath, bytes)
  return {
    ok: true,
    word_file_path: source.virtualPath,
    pdf_file_path: target.virtualPath,
    engine: 'pdf-lib-fallback',
  }
}

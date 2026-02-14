// packages/lib/src/providers/google/messages/create-message.ts

import { createScopedLogger } from '@auxx/logger'
import {
  encodeQuotedPrintable,
  encodeRFC2231Filename,
  foldMimeHeader,
  generateMimeBoundary,
  htmlToPlainText,
  normalizeMessageId,
} from '@auxx/utils'
import type { AttachmentFile } from '../../message-provider-interface'

const logger = createScopedLogger('google-create-message')

export interface CreateEmailMessageInput {
  from: string
  to: string | string[]
  subject?: string
  text?: string
  html?: string
  cc?: string[]
  bcc?: string[]
  replyTo?: string[]
  attachments?: AttachmentFile[]
  inReplyTo?: string
  references?: string
  messageId?: string
}

/**
 * Creates an RFC 822 formatted email message string
 *
 * @param input - Email message parameters
 * @returns RFC 822 formatted message string
 */
export async function createEmailMessage(input: CreateEmailMessageInput): Promise<string> {
  const {
    from,
    to,
    subject = '(No Subject)',
    text,
    html,
    cc,
    bcc,
    replyTo,
    attachments,
    inReplyTo,
    references,
    messageId,
  } = input

  // Generate boundaries
  const mixedBoundary = generateMimeBoundary()
  const altBoundary = generateMimeBoundary()

  // Build headers
  const headers: string[] = []
  headers.push(foldMimeHeader(`From: ${from}`))
  headers.push(foldMimeHeader(`To: ${Array.isArray(to) ? to.join(', ') : to}`))

  if (cc && cc.length > 0) {
    headers.push(foldMimeHeader(`Cc: ${cc.join(', ')}`))
  }
  if (bcc && bcc.length > 0) {
    headers.push(foldMimeHeader(`Bcc: ${bcc.join(', ')}`))
  }
  if (replyTo && replyTo.length > 0) {
    headers.push(foldMimeHeader(`Reply-To: ${replyTo.join(', ')}`))
  }

  // Subject encoding
  if (/[^\x20-\x7E]/.test(subject)) {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
    headers.push(foldMimeHeader(`Subject: ${encodedSubject}`))
  } else {
    headers.push(foldMimeHeader(`Subject: ${subject}`))
  }

  headers.push(`MIME-Version: 1.0`)

  // Threading headers
  if (messageId) {
    headers.push(`Message-ID: ${normalizeMessageId(messageId)}`)
  }
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${normalizeMessageId(inReplyTo)}`)
  }
  if (references) {
    const refs = references
      .split(/\s+/)
      .map((ref) => normalizeMessageId(ref))
      .filter(Boolean)
      .join(' ')
    headers.push(foldMimeHeader(`References: ${refs}`))
  }

  headers.push(`X-Mailer: Auxx-AI-Mailer/2.0`)
  headers.push(`Date: ${new Date().toUTCString()}`)

  const hasAttachments = attachments && attachments.length > 0
  const hasHtml = !!html
  const hasText = !!text || !html

  let message = ''

  if (hasAttachments) {
    message = buildMultipartMixed(
      headers,
      mixedBoundary,
      altBoundary,
      text,
      html,
      hasHtml,
      hasText,
      attachments
    )
  } else if (hasHtml && hasText) {
    message = buildMultipartAlternative(headers, altBoundary, text, html)
  } else if (hasHtml) {
    message = buildSimpleHtml(headers, html)
  } else {
    message = buildSimpleText(headers, text || '')
  }

  // Ensure proper ending
  if (!message.endsWith('\r\n')) {
    message += '\r\n'
  }

  logger.info('Created RFC-compliant email message', {
    from,
    to: Array.isArray(to) ? to : [to],
    hasAttachments,
    attachmentCount: attachments?.length || 0,
    messageLength: message.length,
    hasHtml,
    hasText,
  })

  return message
}

/**
 * Build multipart/mixed message with attachments
 */
function buildMultipartMixed(
  headers: string[],
  mixedBoundary: string,
  altBoundary: string,
  text: string | undefined,
  html: string | undefined,
  hasHtml: boolean,
  hasText: boolean,
  attachments: AttachmentFile[]
): string {
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)

  let message = headers.join('\r\n') + '\r\n\r\n'
  message += 'This is a multi-part message in MIME format.\r\n'
  message += `--${mixedBoundary}\r\n`

  if (hasHtml || hasText) {
    message += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`

    // Plain text part
    message += `--${altBoundary}\r\n`
    message += `Content-Type: text/plain; charset=UTF-8\r\n`
    message += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
    const textContent = text || htmlToPlainText(html || '')
    message += encodeQuotedPrintable(textContent)
    message += `\r\n`

    if (hasHtml) {
      // HTML part
      message += `--${altBoundary}\r\n`
      message += `Content-Type: text/html; charset=UTF-8\r\n`
      message += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
      message += encodeQuotedPrintable(html || '')
      message += `\r\n`
    }

    message += `--${altBoundary}--\r\n`
  }

  // Attachments
  for (const attachment of attachments) {
    message += `--${mixedBoundary}\r\n`

    const filenameHeader = encodeRFC2231Filename(attachment.filename)
    message += `Content-Type: ${attachment.contentType || 'application/octet-stream'}; ${filenameHeader}\r\n`

    if (attachment.inline && attachment.contentId) {
      message += `Content-Disposition: inline; ${filenameHeader}\r\n`
      message += `Content-ID: <${attachment.contentId}>\r\n`
    } else {
      message += `Content-Disposition: attachment; ${filenameHeader}\r\n`
      if (attachment.contentId) {
        message += `Content-ID: <${attachment.contentId}>\r\n`
      }
    }

    message += `Content-Transfer-Encoding: base64\r\n\r\n`

    const base64Content = Buffer.isBuffer(attachment.content)
      ? attachment.content.toString('base64')
      : Buffer.from(attachment.content).toString('base64')

    // 76 characters per line (RFC 2045)
    for (let i = 0; i < base64Content.length; i += 76) {
      message += base64Content.slice(i, Math.min(i + 76, base64Content.length))
      message += '\r\n'
    }
  }

  message += `--${mixedBoundary}--\r\n`
  return message
}

/**
 * Build multipart/alternative message with text and HTML
 */
function buildMultipartAlternative(
  headers: string[],
  altBoundary: string,
  text: string | undefined,
  html: string | undefined
): string {
  headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)

  let message = headers.join('\r\n') + '\r\n\r\n'

  // Plain text
  message += `--${altBoundary}\r\n`
  message += `Content-Type: text/plain; charset=UTF-8\r\n`
  message += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
  message += encodeQuotedPrintable(text || '')
  message += `\r\n`

  // HTML
  message += `--${altBoundary}\r\n`
  message += `Content-Type: text/html; charset=UTF-8\r\n`
  message += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`
  message += encodeQuotedPrintable(html || '')
  message += `\r\n`

  message += `--${altBoundary}--\r\n`
  return message
}

/**
 * Build simple HTML message
 */
function buildSimpleHtml(headers: string[], html: string): string {
  headers.push(`Content-Type: text/html; charset=UTF-8`)
  headers.push(`Content-Transfer-Encoding: quoted-printable`)

  let message = headers.join('\r\n') + '\r\n\r\n'
  message += encodeQuotedPrintable(html)
  message += '\r\n'
  return message
}

/**
 * Build simple text message
 */
function buildSimpleText(headers: string[], text: string): string {
  headers.push(`Content-Type: text/plain; charset=UTF-8`)
  headers.push(`Content-Transfer-Encoding: quoted-printable`)

  let message = headers.join('\r\n') + '\r\n\r\n'
  message += encodeQuotedPrintable(text)
  message += '\r\n'
  return message
}

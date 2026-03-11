// packages/lib/src/email/inbound/raw-email-parser.ts

import PostalMime from 'postal-mime'
import type { InboundEmailAddress, InboundEmailAttachment, ParsedInboundEmail } from './types'

/**
 * RawPostalMimeAddress is the subset of postal-mime address fields used here.
 */
interface RawPostalMimeAddress {
  address?: string | null
  name?: string | null
}

/**
 * RawPostalMimeAttachment is the subset of postal-mime attachment fields used here.
 */
interface RawPostalMimeAttachment {
  filename?: string | null
  mimeType?: string | null
  contentType?: string | null
  disposition?: string | null
  related?: boolean | null
  contentId?: string | null
  size?: number | null
  content?: string | Uint8Array | ArrayBuffer | null
}

/**
 * normalizeAddressList converts parser address output into a normalized array.
 */
function normalizeAddressList(addresses: unknown): InboundEmailAddress[] {
  const addressList = Array.isArray(addresses) ? addresses : addresses ? [addresses] : []

  return addressList
    .map((address): InboundEmailAddress | null => {
      const value = address as RawPostalMimeAddress
      const normalizedAddress = value.address?.trim().toLowerCase()

      if (!normalizedAddress) return null

      return {
        address: normalizedAddress,
        name: value.name?.trim() || null,
      }
    })
    .filter((address): address is InboundEmailAddress => address !== null)
}

/**
 * normalizeAttachmentContent converts postal-mime attachment content into base64.
 */
function normalizeAttachmentContent(content: RawPostalMimeAttachment['content']): Buffer | null {
  if (!content) return null
  if (typeof content === 'string') return Buffer.from(content)
  if (content instanceof Uint8Array) return Buffer.from(content)
  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content))
  return null
}

/**
 * normalizeAttachments converts parser attachment output into the app's normalized shape.
 */
function normalizeAttachments(attachments: unknown): InboundEmailAttachment[] {
  if (!Array.isArray(attachments)) return []

  return attachments.map((attachment, index) => {
    const value = attachment as RawPostalMimeAttachment
    const contentBuffer = normalizeAttachmentContent(value.content)

    return {
      filename: value.filename?.trim() || `attachment-${index + 1}`,
      mimeType: value.mimeType || value.contentType || 'application/octet-stream',
      size: value.size ?? contentBuffer?.byteLength ?? 0,
      inline: value.disposition === 'inline' || value.related === true,
      contentId: value.contentId ?? null,
      content: contentBuffer ? contentBuffer.toString('base64') : null,
    }
  })
}

/**
 * normalizeHeaders converts the parser header output to a plain record.
 */
function normalizeHeaders(headers: unknown): Record<string, string | string[]> {
  if (!headers || typeof headers !== 'object') return {}

  const normalizedEntries = Object.entries(headers as Record<string, unknown>).map(
    ([key, value]) => {
      if (Array.isArray(value)) {
        return [key.toLowerCase(), value.map((item) => String(item))]
      }

      return [key.toLowerCase(), String(value)]
    }
  )

  return Object.fromEntries(normalizedEntries)
}

/**
 * buildSnippet derives a short text snippet from the parsed body.
 */
function buildSnippet(textPlain: string | null, textHtml: string | null): string | null {
  const source = textPlain || textHtml
  if (!source) return null

  const normalized = source.replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  return normalized.slice(0, 200)
}

/**
 * RawEmailParser parses raw MIME into a normalized inbound-email shape.
 */
export class RawEmailParser {
  /**
   * parse converts raw MIME into the normalized ParsedInboundEmail shape.
   */
  async parse(rawEmail: string | Buffer): Promise<ParsedInboundEmail> {
    const parser = new PostalMime()
    const parsed = await parser.parse(rawEmail)

    const textPlain = parsed.text?.trim() || null
    const textHtml = parsed.html?.trim() || null
    const from = normalizeAddressList(parsed.from)[0] ?? null

    return {
      subject: parsed.subject?.trim() || null,
      textPlain,
      textHtml,
      snippet: buildSnippet(textPlain, textHtml),
      from,
      to: normalizeAddressList(parsed.to),
      cc: normalizeAddressList(parsed.cc),
      bcc: normalizeAddressList(parsed.bcc),
      replyTo: normalizeAddressList(parsed.replyTo),
      internetMessageId: parsed.messageId?.trim() || null,
      inReplyTo: parsed.inReplyTo?.trim() || null,
      references: parsed.references?.trim() || null,
      sentAt: parsed.date ? new Date(parsed.date) : null,
      headers: normalizeHeaders(parsed.headers),
      attachments: normalizeAttachments(parsed.attachments),
    }
  }
}

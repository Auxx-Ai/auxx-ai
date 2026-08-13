// packages/lib/src/email/inbound/raw-email-parser.ts

import PostalMime from 'postal-mime'
import { pickEchoedMessageId } from '../../ingest/filtering/echoed-message-id'
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
 * normalizeHeaders converts postal-mime's header output — an array of
 * `{ key, value }` pairs (already-lowercased key, one entry per occurrence,
 * repeated headers like `Received` appear multiple times) — into a plain
 * record, merging repeats of the same key into a `string[]`.
 *
 * Was previously `Object.entries()` over the array itself, which reads array
 * INDICES as keys ('0', '1', …) rather than header names — every header
 * silently vanished into `{ '0': '[object Object]', … }`. Nothing downstream
 * asserted on the shape, so it went unnoticed.
 */
function normalizeHeaders(
  headers: Array<{ key?: string | null; value?: string | null }> | undefined
): Record<string, string | string[]> {
  if (!headers?.length) return {}

  const result: Record<string, string | string[]> = {}
  for (const { key, value } of headers) {
    if (!key || value == null) continue
    const name = key.toLowerCase()
    const existing = result[name]
    if (existing === undefined) {
      result[name] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[name] = [existing, value]
    }
  }
  return result
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
      // Cross-channel echo correlation key (loop-guard plan §6 supplement) — read off
      // the raw header list directly rather than `headers` above, since that map
      // collapses repeats into `string[]`.
      echoedMessageId: pickEchoedMessageId(parsed.headers),
      attachments: normalizeAttachments(parsed.attachments),
    }
  }
}

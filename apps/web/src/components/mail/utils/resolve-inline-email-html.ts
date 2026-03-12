// apps/web/src/components/mail/utils/resolve-inline-email-html.ts

import type { AttachmentMeta } from '~/components/threads/store'

/** Matches cid: image sources in inbound email HTML. */
const CID_IMAGE_SRC_PATTERN = /src=(['"])cid:([^'"]+)\1/gi

/**
 * Normalizes a content ID so HTML cid references can match stored attachment metadata.
 */
export function normalizeContentId(contentId: string): string {
  let normalized = contentId.trim()

  if (normalized.toLowerCase().startsWith('cid:')) {
    normalized = normalized.slice(4)
  }

  normalized = normalized.replace(/^<+|>+$/g, '')

  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // Keep the original value if it is not URI-encoded.
  }

  normalized = normalized.replace(/^<+|>+$/g, '')

  return normalized.toLowerCase()
}

/**
 * Rewrites cid: image references in email HTML to authenticated app routes.
 */
export function resolveInlineEmailHtml(
  html: string | null | undefined,
  attachments: AttachmentMeta[]
): string {
  if (!html) return ''
  if (!html.includes('cid:') || attachments.length === 0) return html

  const inlineAttachmentsByContentId = new Map(
    attachments
      .filter((attachment) => attachment.inline && attachment.contentId)
      .map((attachment) => [normalizeContentId(attachment.contentId!), attachment])
  )

  return html.replace(CID_IMAGE_SRC_PATTERN, (match, quote: string, rawContentId: string) => {
    const attachment = inlineAttachmentsByContentId.get(normalizeContentId(rawContentId))
    if (!attachment) return match

    return `src=${quote}/api/email-attachments/${attachment.id}${quote}`
  })
}

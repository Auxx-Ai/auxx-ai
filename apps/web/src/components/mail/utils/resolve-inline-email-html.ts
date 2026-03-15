// apps/web/src/components/mail/utils/resolve-inline-email-html.ts

import type { AttachmentMeta } from '~/components/threads/store'

/** Matches quoted cid: image sources: src="cid:..." or src='cid:...' */
const CID_SRC_QUOTED_PATTERN = /src=(['"])cid:([^'"]+)\1/gi

/** Matches unquoted cid: image sources: src=cid:... (terminated by space, >, or /) */
const CID_SRC_UNQUOTED_PATTERN = /src=cid:([^\s/>]+)/gi

/** Matches CSS url(cid:...) references, with or without quotes */
const CID_CSS_URL_PATTERN = /url\((['"]?)cid:([^)'"\s]+)\1\)/gi

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

  const hasCid = html.includes('cid:')

  console.log('[resolve-inline-email-html]', {
    hasCid,
    attachmentCount: attachments.length,
    attachmentsWithContentId: attachments
      .filter((a) => a.contentId)
      .map((a) => ({ id: a.id, contentId: a.contentId, inline: a.inline })),
  })

  if (!hasCid || attachments.length === 0) return html

  const attachmentsByContentId = new Map(
    attachments
      .filter((attachment) => attachment.contentId && attachment.inline)
      .map((attachment) => [normalizeContentId(attachment.contentId!), attachment])
  )

  console.log('[resolve-inline-email-html] lookup map keys:', [...attachmentsByContentId.keys()])

  let resolved = html

  // Rewrite quoted src="cid:..." and src='cid:...'
  resolved = resolved.replace(
    CID_SRC_QUOTED_PATTERN,
    (match, quote: string, rawContentId: string) => {
      const normalized = normalizeContentId(rawContentId)
      const attachment = attachmentsByContentId.get(normalized)
      console.log('[resolve-inline-email-html] quoted match', {
        rawContentId,
        normalized,
        found: !!attachment,
        replacedWith: attachment ? `/api/attachments/${attachment.id}/content` : null,
      })
      if (!attachment) return match
      return `src=${quote}/api/attachments/${attachment.id}/content${quote}`
    }
  )

  // Rewrite unquoted src=cid:...
  resolved = resolved.replace(CID_SRC_UNQUOTED_PATTERN, (match, rawContentId: string) => {
    const normalized = normalizeContentId(rawContentId)
    const attachment = attachmentsByContentId.get(normalized)
    console.log('[resolve-inline-email-html] unquoted match', {
      rawContentId,
      normalized,
      found: !!attachment,
    })
    if (!attachment) return match
    return `src="/api/attachments/${attachment.id}/content"`
  })

  // Rewrite CSS url(cid:...)
  resolved = resolved.replace(
    CID_CSS_URL_PATTERN,
    (match, _quote: string, rawContentId: string) => {
      const normalized = normalizeContentId(rawContentId)
      const attachment = attachmentsByContentId.get(normalized)
      console.log('[resolve-inline-email-html] css match', {
        rawContentId,
        normalized,
        found: !!attachment,
      })
      if (!attachment) return match
      return `url('/api/attachments/${attachment.id}/content')`
    }
  )

  return resolved
}

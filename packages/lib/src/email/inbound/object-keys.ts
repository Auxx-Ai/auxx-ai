// packages/lib/src/email/inbound/object-keys.ts

import { createHash } from 'node:crypto'

/**
 * Builds the object key for an inbound email HTML body.
 */
export function buildInboundHtmlBodyKey(params: {
  organizationId: string
  contentScopeId: string
}): string {
  return `email/inbound/${params.organizationId}/${params.contentScopeId}/body.html`
}

/**
 * Builds the object key for an inbound email attachment.
 */
export function buildInboundAttachmentKey(params: {
  organizationId: string
  contentScopeId: string
  attachmentId: string
  filename: string
}): string {
  const safeFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `email/inbound/${params.organizationId}/${params.contentScopeId}/attachments/${params.attachmentId}-${safeFilename}`
}

/**
 * Derives a deterministic attachment ID from provider-stable ingress identity.
 * Uses contentScopeId + attachmentOrder + filename to ensure retries produce the same ID.
 */
export function deriveAttachmentId(
  contentScopeId: string,
  attachmentOrder: number,
  filename: string
): string {
  return createHash('sha256')
    .update(`${contentScopeId}:${attachmentOrder}:${filename}`)
    .digest('hex')
    .slice(0, 24)
}

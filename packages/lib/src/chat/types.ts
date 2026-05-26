// packages/lib/src/chat/types.ts

import type { Database } from '@auxx/database'

/** Common context every chat service module takes as its first argument. */
export interface ServiceContext {
  db: Database
  organizationId: string
}

export interface VisitInfo {
  userAgent?: string
  ipAddress?: string
  referrer?: string
  url?: string
}

/**
 * Per-attachment metadata shipped to the chat widget. Never includes a
 * presigned URL — the widget resolves URLs lazily via
 * `GET /api/chat/attachments/:attachmentId/url` so the URL TTL doesn't outlive
 * a long-lived Pusher payload and we keep frames under the 10KB cap.
 *
 * `id` is the `Attachment.id` (not `MediaAsset.id`) — chat attachments can be
 * either `MediaAsset`-backed (visitor uploads, fresh agent uploads) or
 * `FolderFile`-backed (agent picks from the file manager). The URL endpoint
 * resolves either via `AttachmentService.getDownloadUrl`.
 */
export interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  size: number
}

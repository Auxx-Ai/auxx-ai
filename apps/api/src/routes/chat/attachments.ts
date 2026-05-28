// apps/api/src/routes/chat/attachments.ts

import { randomBytes } from 'node:crypto'
import { database, schema } from '@auxx/database'
import { buildVisitorThreadOwnership } from '@auxx/lib/chat'
import { AttachmentService, createStorageManager, MediaAssetService } from '@auxx/lib/files'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { applyChatCorsHeaders } from './lib'

const log = createScopedLogger('chat-attachments-route')

const attachmentsRoute = new Hono()

const MAX_BYTES = 25 * 1024 * 1024 // 25MB — keep tight; chat attachments are
// rendered inline and we don't want the bundle juggling huge blobs.

attachmentsRoute.options('/', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * POST /api/chat/attachments  (multipart/form-data)
 *
 * Body fields: `file` (binary). Uploads the blob to S3 via the shared
 * StorageManager + MediaAssetService pipeline (same as email composer
 * attachments). Returns the `assetId` which the widget then passes to
 * `POST /api/chat/threads/:threadId/messages` as `attachmentIds[]`.
 */
attachmentsRoute.post('/', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'Expected multipart body' } },
      400
    )
  }

  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'file is required' } },
      400
    )
  }

  const fileName =
    'name' in file && typeof (file as File).name === 'string' ? (file as File).name : 'attachment'
  const mimeType = file.type || 'application/octet-stream'

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength === 0) {
      return c.json(
        { success: false, error: { code: 'INVALID_REQUEST', message: 'Empty file' } },
        400
      )
    }
    if (buffer.byteLength > MAX_BYTES) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB limit`,
          },
        },
        413
      )
    }

    const storageManager = createStorageManager(chat.organizationId)
    const key = `${chat.organizationId}/chat-attachments/${Date.now()}-${randomBytes(8).toString('hex')}-${encodeURIComponent(fileName)}`

    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key,
      content: buffer,
      mimeType,
      size: buffer.byteLength,
      visibility: 'PRIVATE',
      organizationId: chat.organizationId,
    })

    // Visitor uploads have no User id — leave `createdById` null. The asset is
    // org-scoped and tied to the chat thread via the Attachment row that
    // POST /api/chat/threads/:threadId/messages writes on receive.
    const mediaAssetService = new MediaAssetService(chat.organizationId, undefined)
    const { asset } = await mediaAssetService.createWithVersion(
      {
        kind: 'EMAIL_ATTACHMENT',
        purpose: 'ORIGINAL',
        name: fileName,
        mimeType,
        size: BigInt(buffer.byteLength),
        isPrivate: true,
        organizationId: chat.organizationId,
        createdById: null as any,
      } as any,
      storageLocation.id
    )

    return c.json({
      success: true,
      data: {
        id: asset.id,
        name: fileName,
        size: buffer.byteLength,
        type: mimeType,
      },
    })
  } catch (error) {
    log.error('Failed to upload chat attachment', {
      channelId: chat.channelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to upload attachment' } },
      500
    )
  }
})

attachmentsRoute.options('/:attachmentId/url', (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })
  return c.body(null, 204)
})

/**
 * GET /api/chat/attachments/:attachmentId/url
 *
 * Resolve a short-lived presigned download URL for a single Attachment row.
 * Used by the widget to render attachment thumbnails / download chips lazily —
 * the URL never ships in initialize/history responses or Pusher payloads (so
 * the TTL doesn't outlive a long-lived frame).
 *
 * Keyed off `Attachment.id` rather than `MediaAsset.id` because agent-side
 * file-manager picks produce `Attachment.fileId` (→ FolderFile) rows with
 * `assetId = NULL`. Resolution delegates to `AttachmentService.getDownloadUrl`
 * which handles both backings.
 *
 * ACL: passport is org-scoped + visitor-scoped via `visitorParticipantId`. We
 * verify the attachment hangs off a message in a thread the passport owns.
 *
 * Returns 404 (not 403) on ACL miss so we don't leak asset existence.
 */
attachmentsRoute.get('/:attachmentId/url', async (c) => {
  applyChatCorsHeaders(c, { allowCredentials: true })

  const chat = c.get('chat')
  const attachmentId = c.req.param('attachmentId')

  try {
    // Ownership: the outer query already joins schema.Message; pass
    // `useAliases: true` so the inner EXISTS uses aliased Message/Participant
    // copies and Drizzle doesn't conflate them with the outer joins.
    const ownership = buildVisitorThreadOwnership({
      db: database,
      visitorParticipantId: chat.visitorParticipantId,
      contactId: chat.contactId,
      useAliases: true,
    })

    const [hit] = await database
      .select({ one: sql`1` })
      .from(schema.Attachment)
      .innerJoin(schema.Message, eq(schema.Message.id, schema.Attachment.entityId))
      .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
      .where(
        and(
          eq(schema.Attachment.id, attachmentId),
          eq(schema.Attachment.organizationId, chat.organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Thread.integrationId, chat.channelId),
          ownership
        )
      )
      .limit(1)

    if (!hit) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } },
        404
      )
    }

    // Visitor uploads have no User id — pass `undefined` for userId.
    const attachmentService = new AttachmentService(chat.organizationId, undefined)
    let url: string
    try {
      url = await attachmentService.getDownloadUrl(attachmentId)
    } catch {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } },
        404
      )
    }

    // 1h TTL — long enough that paint + clicks succeed without a refetch,
    // short enough to limit damage if a URL leaks.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    return c.json({ success: true, data: { url, expiresAt } })
  } catch (error) {
    log.error('Failed to resolve chat attachment URL', {
      channelId: chat.channelId,
      attachmentId,
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve URL' } },
      500
    )
  }
})

export default attachmentsRoute

// packages/lib/src/email/inbound/attachment-ingest.service.ts

import { type Database, database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { createAttachmentService } from '../../files/core/attachment-service'
import { createMediaAssetService } from '../../files/core/media-asset-service'
import { createStorageManager } from '../../files/storage/storage-manager'
import type {
  AttachmentIngestContext,
  AttachmentIngestInput,
  StoredAttachmentMeta,
} from './ingest-types'
import { buildInboundAttachmentKey, deriveAttachmentId } from './object-keys'

const logger = createScopedLogger('inbound-attachment-ingest')

/**
 * Sanitizes a filename for safe use in storage keys.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Ingests MIME-backed attachments for inbound emails.
 * Creates StorageLocation, MediaAsset, MediaAssetVersion, and canonical Attachment rows.
 */
export class InboundAttachmentIngestService {
  private dbInstance: Database

  constructor(dbInstance: Database = db) {
    this.dbInstance = dbInstance
  }

  /**
   * Ingests all attachments for a single inbound message.
   * Must be called after the Message row exists (needs messageId for Attachment.entityId).
   */
  async ingestAll(
    attachments: AttachmentIngestInput[],
    context: AttachmentIngestContext
  ): Promise<StoredAttachmentMeta[]> {
    if (attachments.length === 0) return []

    const results: StoredAttachmentMeta[] = []

    for (const attachment of attachments) {
      const meta = await this.ingestOne(attachment, context)
      results.push(meta)
    }

    // Reconcile: remove stale ingest-managed attachments for this message
    await this.reconcileAttachments(context, results)

    return results
  }

  /**
   * Ingests a single attachment: upload bytes, create MediaAsset + version, create Attachment.
   */
  private async ingestOne(
    input: AttachmentIngestInput,
    context: AttachmentIngestContext
  ): Promise<StoredAttachmentMeta> {
    const attachmentId = deriveAttachmentId(
      context.contentScopeId,
      input.attachmentOrder,
      input.filename
    )

    // Check if this attachment already exists (retry idempotency)
    const [existing] = await this.dbInstance
      .select({ id: schema.Attachment.id })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.id, attachmentId),
          eq(schema.Attachment.organizationId, context.organizationId)
        )
      )
      .limit(1)

    if (existing) {
      logger.debug('Attachment already exists, skipping duplicate ingest', {
        attachmentId,
        messageId: context.messageId,
      })

      // Load existing metadata to return
      const [att] = await this.dbInstance
        .select({
          assetId: schema.Attachment.assetId,
          assetVersionId: schema.Attachment.assetVersionId,
        })
        .from(schema.Attachment)
        .where(eq(schema.Attachment.id, attachmentId))
        .limit(1)

      return {
        attachmentId,
        assetId: att?.assetId ?? '',
        assetVersionId: att?.assetVersionId ?? '',
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.content.length,
        inline: input.inline,
        contentId: input.contentId ?? null,
        attachmentOrder: input.attachmentOrder,
      }
    }

    // 1. Upload bytes to object storage
    const key = buildInboundAttachmentKey({
      organizationId: context.organizationId,
      contentScopeId: context.contentScopeId,
      attachmentId,
      filename: input.filename,
    })

    const storageManager = createStorageManager(context.organizationId)
    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key,
      content: input.content,
      mimeType: input.mimeType,
      size: input.content.length,
      visibility: 'PRIVATE',
      organizationId: context.organizationId,
    })

    // 2. Create MediaAsset + MediaAssetVersion
    const mediaAssetService = createMediaAssetService(
      context.organizationId,
      context.createdById ?? undefined
    )

    const { asset, version } = await mediaAssetService.createWithVersion(
      {
        kind: 'EMAIL_ATTACHMENT',
        purpose: input.inline ? 'inline-email-image' : 'email-attachment',
        name: sanitizeFilename(input.filename),
        mimeType: input.mimeType,
        size: BigInt(input.content.length),
        isPrivate: true,
        organizationId: context.organizationId,
        createdById: context.createdById ?? undefined,
      },
      storageLocation.id
    )

    // 3. Create canonical Attachment row
    const attachmentService = createAttachmentService(
      context.organizationId,
      context.createdById ?? undefined
    )

    await attachmentService.create({
      id: attachmentId,
      entityType: 'MESSAGE',
      entityId: context.messageId,
      role: input.inline ? 'INLINE' : 'ATTACHMENT',
      title: input.filename,
      sort: input.attachmentOrder,
      contentId: input.contentId ?? null,
      assetId: asset.id,
      assetVersionId: version.id,
      organizationId: context.organizationId,
      createdById: context.createdById ?? undefined,
    })

    logger.debug('Ingested inbound attachment', {
      attachmentId,
      assetId: asset.id,
      assetVersionId: version.id,
      messageId: context.messageId,
      filename: input.filename,
      size: input.content.length,
      inline: input.inline,
    })

    return {
      attachmentId,
      assetId: asset.id,
      assetVersionId: version.id,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.content.length,
      inline: input.inline,
      contentId: input.contentId ?? null,
      attachmentOrder: input.attachmentOrder,
    }
  }

  /**
   * Removes stale ingest-managed attachment rows that are no longer present in the current set.
   * Only targets deterministic-ID attachments (ingest-managed), not user-added ones.
   */
  private async reconcileAttachments(
    context: AttachmentIngestContext,
    currentAttachments: StoredAttachmentMeta[]
  ): Promise<void> {
    const currentIds = new Set(currentAttachments.map((a) => a.attachmentId))

    // Load all existing ingest-managed attachments for this message
    // Deterministic IDs are 24-char hex strings; cuid2 IDs are ~25 chars with mixed alphanumeric
    // We scope by entityType + entityId and check if the ID is NOT in our current set
    const existingAttachments = await this.dbInstance
      .select({
        id: schema.Attachment.id,
        role: schema.Attachment.role,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.organizationId, context.organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, context.messageId)
        )
      )

    // Only delete attachments that look like deterministic ingest IDs (24-char hex)
    // and are not in the current set
    const INGEST_ID_PATTERN = /^[0-9a-f]{24}$/
    const staleIds = existingAttachments
      .filter((a) => INGEST_ID_PATTERN.test(a.id) && !currentIds.has(a.id))
      .map((a) => a.id)

    if (staleIds.length > 0) {
      for (const staleId of staleIds) {
        await this.dbInstance
          .delete(schema.Attachment)
          .where(
            and(
              eq(schema.Attachment.id, staleId),
              eq(schema.Attachment.organizationId, context.organizationId)
            )
          )
      }

      logger.info('Reconciled stale ingest-managed attachments', {
        messageId: context.messageId,
        removedCount: staleIds.length,
        removedIds: staleIds,
      })
    }
  }
}

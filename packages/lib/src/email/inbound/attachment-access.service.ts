// packages/lib/src/email/inbound/attachment-access.service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import type { DownloadRef } from '../../files/adapters/base-adapter'
import { getAttachmentDownloadRef } from '../../files/attachments'
import { createStorageManagerLocationPort } from '../../files/attachments/ports'
import { createS3StoragePort } from '../../files/storage/ports'
import { createStorageManager } from '../../files/storage/storage-manager'

const logger = createScopedLogger('inbound-attachment-access')

/**
 * Provides signed URL access to inbound email attachments stored via canonical Attachment records.
 */
export class InboundAttachmentAccessService {
  /**
   * Returns a signed URL for inline viewing of an attachment.
   * Uses `disposition: 'inline'` for safe MIME types, falls back to `'attachment'`.
   */
  async getInlineViewUrl(params: {
    attachmentId: string
    organizationId: string
  }): Promise<DownloadRef> {
    const attachment = await this.loadAndVerify(params.attachmentId, params.organizationId)

    // Resolve through the standard attachment download chain
    const ref = await getAttachmentDownloadRef(
      { db, organizationId: params.organizationId },
      {
        storage: createS3StoragePort(params.organizationId),
        now: () => new Date(),
        locations: createStorageManagerLocationPort(params.organizationId),
      },
      params.attachmentId
    )
    if (ref.isErr()) throw ref.error
    const downloadRef = ref.value

    logger.debug('Generated inline attachment signed URL', {
      attachmentId: params.attachmentId,
      organizationId: params.organizationId,
      role: attachment.role,
    })

    return downloadRef
  }

  /**
   * Returns a signed URL for downloading an attachment.
   * Always uses `disposition: 'attachment'`.
   */
  async getDownloadUrl(params: {
    attachmentId: string
    organizationId: string
  }): Promise<DownloadRef> {
    const attachment = await this.loadAndVerify(params.attachmentId, params.organizationId)

    if (!attachment.assetVersionId) {
      throw new NotFoundError('Attachment has no stored content')
    }

    // Get the storage location from the asset version
    const [version] = await db
      .select({
        storageLocationId: schema.MediaAssetVersion.storageLocationId,
        mimeType: schema.MediaAssetVersion.mimeType,
      })
      .from(schema.MediaAssetVersion)
      .where(eq(schema.MediaAssetVersion.id, attachment.assetVersionId))
      .limit(1)

    if (!version?.storageLocationId) {
      throw new NotFoundError('Attachment storage location not found')
    }

    const storageManager = createStorageManager(params.organizationId)
    const downloadRef = await storageManager.getDownloadRef({
      locationId: version.storageLocationId,
      ttlSec: 900,
      disposition: 'attachment',
      filename: attachment.title ?? 'attachment',
      mimeType: version.mimeType ?? undefined,
    })

    logger.debug('Generated download attachment signed URL', {
      attachmentId: params.attachmentId,
      organizationId: params.organizationId,
    })

    return downloadRef
  }

  /**
   * Loads an attachment and verifies org ownership.
   */
  private async loadAndVerify(
    attachmentId: string,
    organizationId: string
  ): Promise<{
    id: string
    role: string
    title: string | null
    assetId: string | null
    assetVersionId: string | null
    entityId: string
  }> {
    const [attachment] = await db
      .select({
        id: schema.Attachment.id,
        organizationId: schema.Attachment.organizationId,
        entityType: schema.Attachment.entityType,
        entityId: schema.Attachment.entityId,
        role: schema.Attachment.role,
        title: schema.Attachment.title,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.id, attachmentId),
          eq(schema.Attachment.organizationId, organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE')
        )
      )
      .limit(1)

    if (!attachment) {
      throw new NotFoundError('Attachment not found')
    }

    // Verify the message belongs to the same org
    const [message] = await db
      .select({ id: schema.Message.id })
      .from(schema.Message)
      .where(
        and(
          eq(schema.Message.id, attachment.entityId),
          eq(schema.Message.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!message) {
      throw new NotFoundError('Attachment message not found')
    }

    return attachment
  }
}

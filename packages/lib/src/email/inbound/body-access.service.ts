// packages/lib/src/email/inbound/body-access.service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import type { DownloadRef } from '../../files/adapters/base-adapter'
import { createStorageManager } from '../../files/storage/storage-manager'

const logger = createScopedLogger('inbound-body-access')

/**
 * Provides signed URL access to inbound message HTML bodies stored in object storage.
 */
export class InboundBodyAccessService {
  /**
   * Returns a short-lived signed URL for the inbound HTML body of a message.
   * Verifies org ownership before granting access.
   */
  async getHtmlBodyUrl(params: {
    messageId: string
    organizationId: string
  }): Promise<DownloadRef> {
    const [message] = await db
      .select({
        id: schema.Message.id,
        organizationId: schema.Message.organizationId,
        htmlBodyStorageLocationId: schema.Message.htmlBodyStorageLocationId,
      })
      .from(schema.Message)
      .where(
        and(
          eq(schema.Message.id, params.messageId),
          eq(schema.Message.organizationId, params.organizationId)
        )
      )
      .limit(1)

    if (!message) {
      throw new NotFoundError('Message not found')
    }

    if (!message.htmlBodyStorageLocationId) {
      throw new NotFoundError('Message has no stored HTML body')
    }

    const storageManager = createStorageManager(params.organizationId)
    const downloadRef = await storageManager.getDownloadRef({
      locationId: message.htmlBodyStorageLocationId,
      ttlSec: 900, // 15 minutes
      disposition: 'inline',
      mimeType: 'text/html; charset=utf-8',
    })

    logger.debug('Generated HTML body signed URL', {
      messageId: params.messageId,
      organizationId: params.organizationId,
    })

    return downloadRef
  }
}

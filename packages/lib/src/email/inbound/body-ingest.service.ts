// packages/lib/src/email/inbound/body-ingest.service.ts

import { createScopedLogger } from '@auxx/logger'
import { createStorageManager } from '../../files/storage/storage-manager'
import type { IngestedBodyMeta } from './ingest-types'
import { buildInboundHtmlBodyKey } from './object-keys'

const logger = createScopedLogger('inbound-body-ingest')

/**
 * Context required for body ingest.
 */
export interface BodyIngestContext {
  organizationId: string
  contentScopeId: string
}

/**
 * Input for body ingest.
 */
export interface BodyIngestInput {
  textHtml?: string | null
}

/**
 * Uploads inbound HTML bodies to object storage.
 */
export class InboundBodyIngestService {
  /**
   * Ingests the HTML body of an inbound email into object storage.
   * Returns the storageLocationId for the uploaded body, or null if no HTML is present.
   */
  async ingestBody(input: BodyIngestInput, context: BodyIngestContext): Promise<IngestedBodyMeta> {
    if (!input.textHtml) {
      return { htmlBodyStorageLocationId: null }
    }

    const key = buildInboundHtmlBodyKey({
      organizationId: context.organizationId,
      contentScopeId: context.contentScopeId,
    })

    const storageManager = createStorageManager(context.organizationId)
    const content = Buffer.from(input.textHtml, 'utf-8')

    const storageLocation = await storageManager.uploadContent({
      provider: 'S3',
      key,
      content,
      mimeType: 'text/html; charset=utf-8',
      size: content.length,
      visibility: 'PRIVATE',
      organizationId: context.organizationId,
    })

    logger.debug('Uploaded inbound HTML body', {
      organizationId: context.organizationId,
      contentScopeId: context.contentScopeId,
      storageLocationId: storageLocation.id,
      size: content.length,
    })

    return { htmlBodyStorageLocationId: storageLocation.id }
  }
}

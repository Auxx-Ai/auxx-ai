// packages/lib/src/email/inbound/body-ingest.service.ts

import { createScopedLogger } from '@auxx/logger'
import { defaultDatabase } from '../../files/core/base-service'
import { findStorageLocationByExternalId } from '../../files/storage/location-queries'
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
   *
   * The idempotency lookup is best-effort: if it throws, we fall through to upload.
   * This ensures a transient DB issue cannot prevent the message from being stored.
   */
  async ingestBody(input: BodyIngestInput, context: BodyIngestContext): Promise<IngestedBodyMeta> {
    if (!input.textHtml) {
      return { htmlBodyStorageLocationId: null }
    }

    const key = buildInboundHtmlBodyKey({
      organizationId: context.organizationId,
      contentScopeId: context.contentScopeId,
    })

    // Check if body was already uploaded (idempotency for repeated syncs).
    // Fail-open: lookup errors do not prevent upload.
    //
    // `findStorageLocationByExternalId` returns a `Result`, so the failure mode
    // is an `err` rather than a throw — but the `try` stays, because a *thrown*
    // failure (a connection that dies below the guard) must still fall through
    // to the upload rather than lose the message.
    try {
      const existing = await findStorageLocationByExternalId(
        { db: defaultDatabase(), organizationId: context.organizationId },
        'S3',
        key
      )
      if (existing.isOk() && existing.value) {
        logger.debug('Body already uploaded, returning existing StorageLocation', {
          organizationId: context.organizationId,
          contentScopeId: context.contentScopeId,
          storageLocationId: existing.value.id,
        })
        return { htmlBodyStorageLocationId: existing.value.id }
      }
      if (existing.isErr()) {
        logger.warn('Idempotency lookup failed, proceeding with upload', {
          organizationId: context.organizationId,
          contentScopeId: context.contentScopeId,
          key,
          error: existing.error.message,
        })
      }
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      logger.warn('Idempotency lookup failed, proceeding with upload', {
        organizationId: context.organizationId,
        contentScopeId: context.contentScopeId,
        key,
        error: cause.message,
        cause: (cause as any).cause?.message,
        code: (cause as any).code ?? (cause as any).cause?.code,
      })
    }

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

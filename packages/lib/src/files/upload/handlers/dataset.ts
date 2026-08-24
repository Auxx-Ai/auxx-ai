// packages/lib/src/files/upload/handlers/dataset.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { DocumentService } from '../../../datasets/services/document-service'
import type { DocumentProcessingOptions } from '../../../datasets/types'
import { DocumentProcessingQueue } from '../../../datasets/workers/document-processing-queue'
import { BadRequestError } from '../../../errors'
import { UPLOAD_POLICIES } from '../../types/entities'
import type { PresignedUploadSession } from '../session-types'
import { assertRowInOrg } from './shared'
import type { UploadHandler } from './types'

/** The slice of `session.metadata` a dataset upload carries. */
interface DatasetUploadMetadata {
  datasetId?: string
  documentName?: string
  processingOptions?: DocumentProcessingOptions
}

function datasetMetadata(session: PresignedUploadSession): DatasetUploadMetadata {
  return (session.metadata ?? {}) as DatasetUploadMetadata
}

/** `report.final.csv` → `report.final`. Falls back to the whole name when there is no dot. */
function titleFromFileName(fileName: string): string {
  return fileName.split('.').slice(0, -1).join('.') || fileName
}

/**
 * Dataset documents: parsed, chunked and embedded after upload.
 *
 * The one handler whose upload produces a row outside `files/` — a `Document`,
 * written in the same transaction as the `MediaAsset` it points at, and queued
 * for background parsing only once that transaction has committed.
 */
export const datasetHandler: UploadHandler = {
  ...UPLOAD_POLICIES.DATASET,
  // `entityId` IS the dataset id for this entity type; the document writer reads
  // it out of metadata, so it is copied across before the config is built.
  normalizeInit: (init) => ({
    ...init,
    metadata: { ...init.metadata, datasetId: init.entityId },
  }),
  visibility: 'PRIVATE',
  assetKind: 'DOCUMENT',
  persist: 'asset',

  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.Dataset, init.entityId as string, 'Dataset'),

  /**
   * Create the `Document` that links this dataset to the uploaded bytes.
   *
   * On `tx`, so a failure anywhere in the completion rolls the document back
   * with the asset rather than leaving a document pointing at nothing.
   */
  async onPersist(tx, ctx, deps, result, session) {
    const metadata = datasetMetadata(session)
    if (!metadata.datasetId) {
      throw new BadRequestError('Dataset ID is required for document processing')
    }
    if (!result.assetId) {
      throw new BadRequestError('Dataset upload produced no asset to attach a document to')
    }

    const document = await new DocumentService(tx).createFromFileUpload(
      {
        title: metadata.documentName || titleFromFileName(session.fileName),
        filename: session.fileName,
        mimeType: session.mimeType,
        size: session.expectedSize,
        datasetId: metadata.datasetId,
        uploadedById: session.userId,
        mediaAssetId: result.assetId,
        // Not a content hash — it never was. `createFromFileUpload` uses this
        // only to reject a re-upload of the same bytes into the same dataset,
        // and a name-plus-timestamp never collides, so that check has always
        // been inert here. Left as-is rather than quietly given teeth.
        checksum: `${session.fileName}-${deps.now().getTime()}`,
        originalPath: session.fileName,
        processingOptions: metadata.processingOptions,
      },
      ctx.organizationId
    )

    return { documentId: document.id }
  },

  /**
   * Queue the document for parsing and embedding.
   *
   * **Behaviour change, and the point of the hook split.**
   * `DatasetAssetProcessor` enqueued this from inside `createDocumentRecord`,
   * which ran inside the route's still-open transaction — so the worker could
   * pick the job up and fail to find the `Document` it names. The row is
   * committed by the time this runs (Tier-1 §1.3).
   *
   * The document is re-read rather than carried across the boundary: the job
   * payload needs six of its columns, and a `PersistResult` that grew a
   * dataset-shaped pocket would make every other handler pay for it.
   */
  async afterCommit(ctx, _deps, result, session) {
    const metadata = datasetMetadata(session)
    if (metadata.processingOptions?.skipParsing || !result.documentId) return

    const document = await ctx.db.query.Document.findFirst({
      where: and(
        eq(schema.Document.id, result.documentId),
        eq(schema.Document.organizationId, ctx.organizationId)
      ),
    })
    if (!document) return

    await DocumentProcessingQueue.queueDocumentProcessing(
      document.id,
      document.datasetId,
      document.organizationId,
      session.userId,
      {
        priority: 1,
        delay: 0,
        mediaAssetId: document.mediaAssetId ?? undefined,
        fileName: document.filename,
        fileSize: Number(document.size),
        mimeType: document.mimeType,
        documentType: document.type,
      }
    )
  },
}

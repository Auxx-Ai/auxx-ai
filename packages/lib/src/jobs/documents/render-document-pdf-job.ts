// packages/lib/src/jobs/documents/render-document-pdf-job.ts

import type { RecordId } from '@auxx/types/resource'
import type { DocumentType } from '../../documents/ensure-pdf'
import { ensureDocumentPdf } from '../../documents/ensure-pdf'
import type { JobContext } from '../types'

/** Payload for {@link renderDocumentPdfJob}. */
export interface RenderDocumentPdfJobData {
  documentType: DocumentType
  organizationId: string
  recordId: RecordId
  actorId: string
}

/**
 * Worker job — renders (or reuses) a quote/invoice PDF (money MQ2 build spec §C.3; MI1 §H.1
 * generalizes it to `documentType`). Thin wrapper around {@link ensureDocumentPdf}; the
 * return value becomes the BullMQ job result, which `ensureDocumentPdfViaQueue` reads back
 * via `waitUntilFinished`.
 */
export const renderDocumentPdfJob = async (ctx: JobContext<RenderDocumentPdfJobData>) => {
  const { documentType, organizationId, recordId, actorId } = ctx.data
  return ensureDocumentPdf({ documentType, organizationId, recordId, actorId })
}

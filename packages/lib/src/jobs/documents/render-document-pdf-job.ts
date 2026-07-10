// packages/lib/src/jobs/documents/render-document-pdf-job.ts

import type { RecordId } from '@auxx/types/resource'
import { ensureQuotePdf } from '../../documents/ensure-pdf'
import type { JobContext } from '../types'

/** Payload for {@link renderDocumentPdfJob}. */
export interface RenderDocumentPdfJobData {
  organizationId: string
  quoteRecordId: RecordId
  actorId: string
}

/**
 * Worker job — renders (or reuses) a quote's PDF (money MQ2 build spec §C.3). Thin
 * wrapper around {@link ensureQuotePdf}; the return value becomes the BullMQ job result,
 * which `ensureQuotePdfViaQueue` reads back via `waitUntilFinished`.
 */
export const renderDocumentPdfJob = async (ctx: JobContext<RenderDocumentPdfJobData>) => {
  const { organizationId, quoteRecordId, actorId } = ctx.data
  return ensureQuotePdf({ organizationId, quoteRecordId, actorId })
}

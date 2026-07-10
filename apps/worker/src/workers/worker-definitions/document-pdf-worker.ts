// apps/worker/src/workers/worker-definitions/document-pdf-worker.ts

import { renderDocumentPdfJob } from '@auxx/lib/jobs'
import { Queues } from '@auxx/lib/jobs/queues'
import { createWorker } from '../utils/createWorker'

const jobMappings = {
  renderDocumentPdf: renderDocumentPdfJob,
}

/**
 * Quote/invoice PDF render worker (money MQ2 build spec §C.3; MI1 §H.1 generalizes the job
 * name/payload to `documentType`). Concurrency capped at 2 —
 * react-pdf's yoga-WASM layout pass is CPU-bound (README risk note), unlike the mostly
 * I/O-bound thumbnail worker.
 */
export function startDocumentPdfWorker() {
  return createWorker(Queues.documentPdfQueue, jobMappings, {
    concurrency: 2,
  })
}

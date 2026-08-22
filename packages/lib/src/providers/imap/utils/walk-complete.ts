// packages/lib/src/providers/imap/utils/walk-complete.ts

import type { ImapFolderCheckpoint } from '../types'

/**
 * Whether the IMAP windowed full sync ("folder walk") has finished for every
 * folder: no enabled label carries a checkpoint whose phase is not `'done'`.
 * A committed folder has its checkpoint cleared entirely (`null`), which also
 * counts as complete.
 *
 * Shared by `maybeTransitionImapToIdle` (which flips the integration to IDLE)
 * and the backfill completion stamp in `messagesImportJob` — the cache-drain
 * path can go IDLE while folder-walk batches are still in flight (an IMAP
 * first walk carries its work in `imapImportBatchJob` payloads, not the Redis
 * cache), and stamping `initialBackfillCompletedAt` at that moment would
 * reopen `message:received` for the rest of the historical walk.
 */
export function isImapWalkComplete(labels: Array<{ syncCheckpoint: string | null }>): boolean {
  return !labels.some((label) => {
    if (!label.syncCheckpoint) return false
    const checkpoint: ImapFolderCheckpoint = JSON.parse(label.syncCheckpoint)
    return checkpoint.phase !== 'done'
  })
}

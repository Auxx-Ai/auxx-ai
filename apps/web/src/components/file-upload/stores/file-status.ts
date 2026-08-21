// apps/web/src/components/file-upload/stores/file-status.ts

import type { FileState } from './types'

/**
 * True while a file still owns work — and therefore a `maxFiles` slot, a dedupe
 * claim, an uploading badge, and a completion-handler hold.
 *
 * One predicate on purpose. Its call sites each hand-rolled
 * `status !== 'completed' && status !== 'failed'`, which treated `cancelled`
 * (and `deleting`) as in-flight forever: `cancelFile` only flips status and
 * never removes the file from its session's `fileIds`, so a single cancelled
 * upload permanently consumed a `maxFiles: 1` field's only slot, blocked
 * re-picking the same file via the dedupe, spun the field's uploading badge
 * indefinitely, and kept the unmount cleanup from ever releasing its
 * completion handler.
 */
export function isFileInFlight(status: FileState['status']): boolean {
  return (
    status !== 'completed' && status !== 'failed' && status !== 'cancelled' && status !== 'deleting'
  )
}

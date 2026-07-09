// packages/lib/src/jobs/approvals/learned-extraction-gates.ts

import type { ThreadEntity } from '@auxx/database'

/**
 * Row-local noise gates for the learned-KB extraction job, in their own
 * module so tests don't have to import the job (which pulls in bullmq).
 * Returns a skip reason or `undefined` when the thread is worth an
 * extraction run. The `learnedExtractedAt >= lastMessageAt` comparison is
 * what makes a reopen→re-close with no new messages a no-op while a thread
 * that accrued new conversation stays eligible.
 */
export function learnedExtractionSkipReason(
  thread: Pick<
    ThreadEntity,
    'status' | 'mergedIntoThreadId' | 'messageCount' | 'learnedExtractedAt' | 'lastMessageAt'
  >
): string | undefined {
  if (thread.status !== 'ARCHIVED') return 'not_resolved'
  if (thread.mergedIntoThreadId) return 'merged'
  if (thread.messageCount < 2) return 'too_few_messages'
  if (
    thread.learnedExtractedAt &&
    (!thread.lastMessageAt || thread.learnedExtractedAt >= thread.lastMessageAt)
  ) {
    return 'already_extracted'
  }
  return undefined
}

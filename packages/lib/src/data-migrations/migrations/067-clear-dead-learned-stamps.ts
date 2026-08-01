// packages/lib/src/data-migrations/migrations/067-clear-dead-learned-stamps.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-067')

/**
 * Clear `Thread.learnedExtractedAt` on threads the AI Memory extractor never
 * actually read.
 *
 * **Why they exist.** Capture-mode runs bind to a human member and refuse to
 * run for anyone else. The learned-extraction job used to fall back to
 * `Organization.systemUserId` — deliberately NOT a member — so every thread
 * without a human assignee produced an instant no-op that the job then
 * recorded as "extracted". The stamp is the dedupe gate, so those threads were
 * excluded from AI Memory permanently, and fixing the principal resolution
 * alone would not bring them back.
 *
 * **Why `notInArray` over a bundle join.** A stamp is only trustworthy if a run
 * produced something: threads that reached the model and returned `[noop]` are
 * indistinguishable from the dead ones by timestamp alone. Threads that DID
 * produce a proposal are identifiable — they have a learned bundle — so those
 * keep their stamp and everything else is re-opened. Re-running an extraction
 * on a handful of already-seen threads is cheap and gated; never re-running one
 * is the failure this repairs.
 *
 * Raw Drizzle on purpose (project convention for data migrations): the thread
 * service path fires realtime and reconciliation side effects that a column
 * fixup has no business entering.
 */
export const migration067ClearDeadLearnedStamps: DataMigrationDef = {
  id: '067-clear-dead-learned-stamps',
  description: 'Clear learnedExtractedAt on threads that never produced a memory proposal',
  async run(db: Database): Promise<void> {
    const proposed = await db
      .selectDistinct({ threadId: schema.AiSuggestion.threadId })
      .from(schema.AiSuggestion)
      .where(
        and(
          eq(schema.AiSuggestion.triggerSource, 'learned-extraction'),
          isNotNull(schema.AiSuggestion.threadId)
        )
      )
    const keep = proposed.map((row) => row.threadId).filter((id): id is string => id !== null)

    const cleared = await db
      .update(schema.Thread)
      .set({ learnedExtractedAt: null })
      .where(
        and(
          isNotNull(schema.Thread.learnedExtractedAt),
          keep.length > 0 ? notInArray(schema.Thread.id, keep) : sql`true`
        )
      )
      .returning({ id: schema.Thread.id })

    logger.info('Cleared dead learned-extraction stamps', {
      cleared: cleared.length,
      keptWithProposals: keep.length,
    })
  },
}

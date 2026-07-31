// packages/lib/src/sequences/sequence-limits.ts

import { type Database, schema } from '@auxx/database'
import { and, count, eq, isNull } from 'drizzle-orm'

/**
 * The single counter behind the `sequencesLimit` plan limit.
 *
 * Counts **org-authored** sequences only — rows with a `templateKey` are the five
 * client-notification templates `seedClientNotificationSequences` writes into every
 * new org, and they are excluded for a reason that is not merely cosmetic:
 * {@link deleteSequence} *forbids* deleting a `templateKey` row. Counting them would
 * put every org 5 toward its cap on day one with **no action available to get back
 * under it** — the org would be permanently blocked from creating a sequence. (Same
 * class of bug as the seeded views/sequences that broke `savedViews` and
 * `workflowsLimit`; see `table-views/saved-view-limits.ts`.)
 *
 * Note this counts DRAFT sequences too. A draft still occupies the surface, still
 * holds a compiled `WorkflowApp`, and is one publish away from sending — metering
 * only `enabled` rows would let an org stage unlimited cadences and flip them all on.
 *
 * Exported so the create gate (`sequence.create`) and `OverageDetectionService` read
 * one number rather than growing two queries that drift.
 */
export async function countSequencesUsed(db: Database, organizationId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(schema.Sequence)
    .where(
      and(eq(schema.Sequence.organizationId, organizationId), isNull(schema.Sequence.templateKey))
    )

  return result?.value ?? 0
}

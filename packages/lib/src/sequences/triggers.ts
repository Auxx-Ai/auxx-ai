// packages/lib/src/sequences/triggers.ts
// Per-org enabled-trigger lookup (client-notifications plan §4.3/§7 open question #3 —
// resolved: a targeted indexed query, not an org-cache entry — event-trigger hooks are
// low-volume admin-adjacent actions, not an ingest hot path). Uses
// `Sequence_organizationId_triggerType_idx`. Multiple sequences may share a trigger — every
// hook site loops the result and enrolls into each.

import type { SequenceTriggerType } from '@auxx/database'
import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { SequenceEntity } from './types'

/** Every `status: 'enabled'` (published, since publish is the only door to `'enabled'`)
 * sequence for an org's trigger. */
export async function getEnabledSequencesForTrigger(
  db: Database,
  organizationId: string,
  triggerType: SequenceTriggerType
): Promise<SequenceEntity[]> {
  return db.query.Sequence.findMany({
    where: and(
      eq(schema.Sequence.organizationId, organizationId),
      eq(schema.Sequence.triggerType, triggerType),
      eq(schema.Sequence.status, 'enabled')
    ),
  })
}

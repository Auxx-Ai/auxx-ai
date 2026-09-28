// packages/lib/src/data-migrations/migrations/199-part-kind-conflict-confirmed.ts
// see plans/mrp/17-stock-setup-flow.md D3

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:199')

const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 199: the hidden `part_kind_conflict_confirmed` flag on `part`. No backfill: absent
 * reads as "not confirmed". Idempotent — `ensureCustomFields` is INSERT-only.
 */
export const migration199PartKindConflictConfirmed: PerOrgMigration = {
  id: '199-part-kind-conflict-confirmed',
  description: 'Adds the hidden part_kind_conflict_confirmed flag on part. No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    const def = existing.entityDefs.get('part')
    if (!def) return { ...state, alreadyUpToDate: true }

    const field = PART_FIELDS.kindConflictConfirmed
    if (!field)
      throw new Error('The part registry is missing kindConflictConfirmed (migration 199)')
    await ensureCustomFields(
      db,
      organizationId,
      'part',
      def.id,
      { kindConflictConfirmed: field },
      existing,
      state
    )

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 199 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }
    return { ...state, alreadyUpToDate: !changed }
  },
}

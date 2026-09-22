// packages/lib/src/data-migrations/migrations/184-fulfillment-posting-marker.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { FULFILLMENT_FIELDS } from '../../resources/registry/resources/fulfillment-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:184')

const FULFILLMENT = 'fulfillment'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 184: `fulfillment.postingBlockedReason` / `.postingBlockedAt`, the
 * shipment poster's marker (`plans/accounting/tasks/88-refunds-do-not-block-their-receipts.md`
 * §7.4). A movement carries the same two facts as columns; a fulfillment is an
 * entity record, so they are fields.
 *
 * No backfill: nothing has written a marker before this migration.
 * Idempotent - `ensureCustomFields` is INSERT-only.
 */
export const migration184FulfillmentPostingMarker: PerOrgMigration = {
  id: '184-fulfillment-posting-marker',
  description:
    'Adds fulfillment.postingBlockedReason and .postingBlockedAt - why the shipment poster last ' +
    'refused a shipment and when, the marker its sweep backs off on (88 §7.4). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const fulfillmentDef = existing.entityDefs.get(FULFILLMENT)
    if (!fulfillmentDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of ['postingBlockedReason', 'postingBlockedAt'] as const) {
      const field = FULFILLMENT_FIELDS[key] as ResourceField | undefined
      if (!field) throw new Error(`The fulfillment registry is missing ${key} (migration 184)`)
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      FULFILLMENT,
      fulfillmentDef.id,
      fields,
      existing,
      state
    )

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 184 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

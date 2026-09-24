// packages/lib/src/data-migrations/migrations/193-part-channel-cost.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:193')

const PART = 'part'
const NEW_KEYS = ['channelCost', 'standardCostOrigin'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/** Migration 193: a channel's unit cost and the standard's origin on the part (106 D5, D9). No backfill. */
export const migration193PartChannelCost: PerOrgMigration = {
  id: '193-part-channel-cost',
  description:
    'Adds part.channelCost (a sales channel unit cost that seeds the first standard) and ' +
    'part.standardCostOrigin (which door wrote the standard) (106 D5, D9). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const partDef = existing.entityDefs.get(PART)
    if (!partDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_KEYS) {
      const field = PART_FIELDS[key]
      if (!field) throw new Error(`The part registry is missing ${key} (migration 193)`)
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, PART, partDef.id, fields, existing, state)

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 193 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

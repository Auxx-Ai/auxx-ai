// packages/lib/src/data-migrations/migrations/197-mrp-planning-fields.ts
// see plans/mrp/02-data-structures.md §4 and §4.2

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../resources/registry/resources/company-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:197')

/** The registry keys this migration provisions, per entity type. */
export const MRP_FIELD_KEYS = {
  part: [
    'mrpBufferMode',
    'buildLeadTimeDays',
    'buildCycleDays',
    'mrpLeadTimeFactor',
    'mrpVariabilityFactor',
  ],
  company: ['orderMode', 'orderCycleDays', 'nextOrderDate'],
} as const

const REGISTRIES: Record<keyof typeof MRP_FIELD_KEYS, Record<string, ResourceField>> = {
  part: PART_FIELDS,
  company: COMPANY_FIELDS,
}

const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 197: the MRP planning overrides on `part` and the supplier ordering rhythm on
 * `company`. No backfill: null means the planner's proposal or default. Idempotent —
 * `ensureCustomFields` is INSERT-only.
 */
export const migration197MrpPlanningFields: PerOrgMigration = {
  id: '197-mrp-planning-fields',
  description:
    'Adds the MRP planning fields: part_mrp_buffer_mode, part_build_lead_time_days, ' +
    'part_build_cycle_days, part_mrp_lead_time_factor, part_mrp_variability_factor, ' +
    'company_order_mode, company_order_cycle_days, company_next_order_date. No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    for (const entityType of Object.keys(MRP_FIELD_KEYS) as (keyof typeof MRP_FIELD_KEYS)[]) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue

      const fields: Record<string, ResourceField> = {}
      for (const key of MRP_FIELD_KEYS[entityType]) {
        const field = REGISTRIES[entityType][key]
        if (!field) throw new Error(`The ${entityType} registry is missing ${key} (migration 197)`)
        fields[key] = field
      }
      await ensureCustomFields(db, organizationId, entityType, def.id, fields, existing, state)
    }

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 197 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

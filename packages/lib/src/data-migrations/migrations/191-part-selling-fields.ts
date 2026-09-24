// packages/lib/src/data-migrations/migrations/191-part-selling-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:191')

const PART = 'part'
const SELLING_KEYS = ['sellable', 'sellPrice', 'markup', 'taxable'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/** Migration 191: the part carries its own selling fields (107 D3, D5). No backfill (107 §5). */
export const migration191PartSellingFields: PerOrgMigration = {
  id: '191-part-selling-fields',
  description:
    'Adds part.sellable, sellPrice, markup and taxable: the catalog item folds into the part ' +
    '(107 D3, D5). No backfill, test data is reset',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const partDef = existing.entityDefs.get(PART)
    if (!partDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of SELLING_KEYS) {
      const field = PART_FIELDS[key]
      if (!field) throw new Error(`The part registry is missing ${key} (migration 191)`)
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, PART, partDef.id, fields, existing, state)

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 191 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

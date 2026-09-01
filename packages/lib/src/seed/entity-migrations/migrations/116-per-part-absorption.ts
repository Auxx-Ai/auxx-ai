// packages/lib/src/seed/entity-migrations/migrations/116-per-part-absorption.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:116')

/** The def that receives the two fields. Created by an earlier migration. */
const PART_ENTITY_TYPE = 'part'

/**
 * The two fields added, listed by REGISTRY KEY rather than taken as "everything
 * new on `PART_FIELDS`".
 *
 * Migration 109's comment gives the reason and it holds here: naming the keys
 * means a later, unrelated field on the part registry cannot silently join this
 * migration's payload.
 */
const FIELD_KEYS = ['laborCostPerUnit', 'overheadCostPerUnit'] as const

/**
 * Migration 116: per-part labour and overhead absorption overrides
 * (plans/money/tasks/22-per-part-absorption.md).
 *
 * ## Why
 *
 * `standard-cost-roll.ts` read ONE org-wide rate for every built part, at every
 * level of every bill of materials. Because a built parent's material is
 * `SUM(child.standardCost x qty)` and a child's standard already contains its
 * own absorption, the flat rate compounds once per level: a finished good over 8
 * subassemblies carried 9 x the rate. On the real lift that was $270.00 of a
 * $441.07 standard against $171.07 of actual material, and the same $30.00 was
 * absorbed by a $1.88 feet assembly and a $68.22 motor assembly alike.
 *
 * These two fields let a part state its own rate. NULL falls through to the org
 * rate; a stored `0` means "absorbs nothing", which is how a subassembly is made
 * cost-transparent without inventing a fourth `part_kind`.
 *
 * ## Why they are creatable and updatable
 *
 * Unlike the five `part_standard_*` fields beside them, these are INPUTS. Both
 * capabilities are load-bearing and they do different jobs: `getImportableFields`
 * filters on `creatable && !hidden && !relationship` and never reads `updatable`,
 * so `creatable` is what puts the column in the import picker, while the CRUD
 * layer enforces `updatable` on the write, so `updatable` is what lets a second
 * import pass revise the numbers. Setting 43 built parts is an
 * export-edit-import round trip, not 43 drawers.
 *
 * ## Inert
 *
 * 🛑 Two nullable fields and NO backfill. Every existing part reads NULL, falls
 * through to the org rate, and produces exactly the standard cost it produces
 * today. This migration must not change one stored `part_standard_*` value —
 * only a subsequent roll can, and only for parts somebody has since given an
 * override.
 *
 * Idempotent: `ensureCustomFields` creates nothing on a second run.
 */
export const migration116PerPartAbsorption: EntityMigration = {
  id: '116-per-part-absorption',
  description:
    'Add part_labor_cost_per_unit and part_overhead_cost_per_unit — per-part absorption overrides',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(PART_ENTITY_TYPE)
    // An org with no `part` def has nothing to hang these on; a later run of the
    // migration that seeds it will not create them, but neither did 109's
    // `part` fields, and the seeder covers a fresh org from the registry.
    if (!def) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of FIELD_KEYS) {
      const field = PART_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`part registry is missing the key "${key}" (migration 116)`)
      }
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, PART_ENTITY_TYPE, def.id, fields, existing, state)

    const alreadyUpToDate = state.fieldsCreated === 0

    // New fields are invisible to every read path until the per-org caches that
    // serve them are dropped. `runEntityMigrationsForOrg` does this after the
    // whole batch, but `up()` can also be invoked directly, so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 116 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}

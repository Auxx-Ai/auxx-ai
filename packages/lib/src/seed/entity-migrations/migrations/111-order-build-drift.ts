// packages/lib/src/seed/entity-migrations/migrations/111-order-build-drift.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:111')

/**
 * The two defs that receive a field. Both are tolerated as absent: an org short
 * of migration 107 has no `order` and one short of 109 has no `build`, and in
 * either case there is nothing to fingerprint yet. A later run closes the gap.
 */
const TARGETS = ['order', 'build'] as const

/**
 * Listed by REGISTRY KEY rather than taken as "everything new on that registry",
 * so a later unrelated field cannot silently join this migration's payload —
 * the same discipline 109 records.
 */
const FIELD_KEYS: Record<(typeof TARGETS)[number], readonly string[]> = {
  order: ['buildRevision'],
  build: ['orderRevision'],
}

/**
 * Migration 111: the order↔build drift pair, INERT
 * (plans/products/13-order-build-reconciliation.md Model A+).
 *
 * ## What these two fields are
 *
 * `order_build_revision` is what the order currently asks production for, as one
 * hash. `build_order_revision` is the same hash as it stood when the build was
 * raised. **Drift is the two differing** — nothing more, and deliberately nothing
 * more: this pair mutates no build, ever.
 *
 * That restraint is the reason plan 13 chose Model A+ over Model B. An order stays
 * editable by design (13 §1.3, stated twice in source), the auto-build trigger
 * fires once on `created`, and today the two silently disagree with nothing on any
 * screen saying so (13 §0). Making the disagreement VISIBLE fixes that defect
 * without answering 13 Q1 — snapshot or projection? — which nobody has decided.
 * Whoever decides it inherits a convergence check already computed and stored.
 *
 * ## Inert on arrival, and briefly so
 *
 * Both fields read NULL and have no writer at the moment this migration runs, the
 * same B10 precedent 109 followed (`plans/products/build/README.md`). A field with
 * no writer carries no behavioural risk, and it clears the org-cache and
 * def-exists gates for the code that lands with it.
 *
 * ## Id space
 *
 * 111 was the next free number counted across BOTH `data-migrations/migrations/`
 * (which reaches 105) and `seed/entity-migrations/migrations/` (which reaches
 * 110), and verified against every branch — the space is shared and has already
 * collided once, at 103.
 *
 * **No DDL.** Both are `CustomField` rows on existing defs; nothing here touches
 * a Postgres table. If a `.sql` file appears under `packages/database/drizzle/`
 * for this work, something is wrong.
 *
 * Idempotent — `ensureCustomFields` skips a field that already exists.
 */
export const migration111OrderBuildDrift: EntityMigration = {
  id: '111-order-build-drift',
  description:
    'Add the inert order_build_revision / build_order_revision drift pair, so an order ' +
    'that changed after its builds were raised can say so',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const registries: Record<(typeof TARGETS)[number], Record<string, ResourceField>> = {
      order: ORDER_FIELDS,
      build: BUILD_FIELDS,
    }

    for (const entityType of TARGETS) {
      const def = existing.entityDefs.get(entityType)
      // Absent rather than failed: an org that has not reached 107 (order) or
      // 109 (build) has nothing to fingerprint, and both migrations seed their
      // full registry, so a later run picks these up on its own.
      if (!def) continue

      const fields: Record<string, ResourceField> = {}
      for (const key of FIELD_KEYS[entityType]) {
        const field = registries[entityType][key]
        // Loud rather than silent: a renamed registry key would otherwise make
        // this migration quietly create one field fewer than it claims to.
        if (!field) {
          throw new Error(`${entityType} registry is missing the key "${key}" (migration 111)`)
        }
        fields[key] = field
      }

      await ensureCustomFields(db, organizationId, entityType, def.id, fields, existing, state)
    }

    const alreadyUpToDate = state.fieldsCreated === 0

    // A new field is invisible to every read path until the per-org caches that
    // serve it are dropped. `runEntityMigrationsForOrg` does this after the whole
    // batch, but `up()` can also be invoked directly, so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 111 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}

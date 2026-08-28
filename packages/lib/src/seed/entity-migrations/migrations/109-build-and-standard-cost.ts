// packages/lib/src/seed/entity-migrations/migrations/109-build-and-standard-cost.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:109')

/** The one def this migration creates. */
const NEW_TYPES = ['build'] as const

/**
 * Pre-existing defs that receive fields here. `stock_movement` is the hard
 * dependency (checked separately, it is what a build actually writes); `part`
 * and `order` are tolerated as absent, since an org short of the migration that
 * seeds them has nothing to hang an inverse off yet and a later run closes it.
 */
const EXISTING_TYPES = ['stock_movement', 'part', 'order'] as const

/**
 * The fields added to defs this migration does not create, listed by REGISTRY
 * KEY rather than taken as "everything new on that registry" — so a later,
 * unrelated field does not silently join this migration's payload.
 */
const INCUMBENT_FIELD_KEYS: Record<(typeof EXISTING_TYPES)[number], readonly string[]> = {
  // The frozen standard and its three components, plus the build inverse.
  part: [
    'standardMaterialCost',
    'standardLaborCost',
    'standardOverheadCost',
    'standardCost',
    'standardCostEffectiveAt',
    'builds',
  ],
  // `stock_movement_unit_cost` / `_extended_cost` / `_cost_basis` /
  // `_gl_account` are NOT here — they shipped with 108 and 19 rows already
  // carry values. `stock_movement_gl_posting` is Gap B's, not this migration's.
  stock_movement: ['build', 'qtyPerUnit'],
  order: ['cancelledAt', 'builds'],
}

/**
 * Migration 109: the `build` entity and the frozen standard cost, in ONE pass
 * and completely INERT (plans/products/build/01-build-plan.md §1,
 * plans/products/build/README.md B10).
 *
 * ## What "inert" means here, and why it is the whole point
 *
 * Every field this migration creates reads NULL and **has no writer**.
 * `packages/lib/src/builds/` does not exist; `rollStandardCost` does not exist;
 * nothing sets `order_cancelled_at`. A field with no writer does nothing at
 * all, so this migration carries no behavioural risk whatsoever — and it clears
 * the org-cache and def-exists gates for every phase after it.
 *
 * That is also what makes the phasing safe. A `planned` build writes no stock
 * movements (README B2), and `completeBuild` — the only function that ever
 * writes — is gated on a real `part_standard_cost`. So the entity, its UI and
 * the auto-build trigger can all land and be used before the costing half
 * exists, with no way to produce a wrong number early.
 *
 * The precedent is purchasing P13, which shipped its two payment defs seeded,
 * hidden and inert in the same migration as the rest and recorded exactly why:
 * it avoids a second trip through the ten-file registration set, no org-cache
 * dance across every org, and no waiting on a def-exists gate. ⚠️ P13's
 * condition applies here too — an entity with zero rows can be reshaped freely,
 * and the freedom lasts only while nothing writes. `108-purchasing.test.ts`
 * enforces that emptiness by scanning this source tree for the names, which is
 * why they are not spelled out here.
 *
 * ## What it adds
 *
 * The `build` def with all 24 of `BUILD_FIELDS`, **`isVisible: false`**. Phase
 * 2 flips that to true when the list, the detail page and the completion form
 * land; a visible nav entry for an empty list with no way to create a row is a
 * worse first impression than no entry at all.
 *
 * On `part` (§1.2), the frozen half of the two costs a part carries:
 *
 *   part.standardMaterialCost      CURRENCY   frozen material roll-up
 *   part.standardLaborCost         CURRENCY   absorbed direct labour per unit
 *   part.standardOverheadCost      CURRENCY   applied overhead per unit
 *   part.standardCost              CURRENCY   the sum — what every movement stamps
 *   part.standardCostEffectiveAt   DATETIME   when this standard took effect
 *   part.builds                    has_many   -> build (inverse of build.part)
 *
 * Splitting the three components is load-bearing rather than tidy: the
 * fulfillment COGS entry has to land across 5000 Materials / 5010 Direct Labor
 * / 5020 Applied Overhead, and it can only do that if the finished good's
 * standard remembers its composition.
 *
 * On `stock_movement`:
 *
 *   stock_movement.build           belongs_to -> build
 *   stock_movement.qtyPerUnit      NUMBER      the as-built BOM snapshot
 *
 * On `order`:
 *
 *   order.cancelledAt              DATETIME   nullable, `creatable: true`
 *   order.builds                   has_many   -> build (inverse of build.order)
 *
 * ⚠️ `order_cancelled_at` is `creatable: true` because a Shopify order can
 * arrive ALREADY cancelled. Set, never cleared.
 *
 * ## Why this is ONE migration and not three
 *
 * Same argument as 108. `linkNewRelationships` links what is in the FIELD MAP
 * it is handed, not what is in the database. Split across 109 -> 110 -> 111,
 * `part.builds`, `stock_movement.build` and `order.builds` would each be
 * materialised while `build` did not exist yet, the linker would skip all three
 * with a debug line, and a later migration would have to re-read those rows out
 * of `ExistingState` purely so the linker could see them. Every counterpart is
 * in the same map before the single `linkNewRelationships` call below, so all
 * of them resolve there. If a rehydration block is ever needed here, that means
 * a def moved out of this migration and the fix is to move it back.
 *
 * ## Deliberately absent
 *
 * **No backfill, anywhere** (§1.5). Every new field reads NULL on every
 * existing row and every future reader must handle that. There is nothing to
 * reconstruct: a past movement's cost is not recoverable from a later ledger
 * state, and pretending otherwise is the Stocksmith failure exactly.
 *
 * **No field views and no default table views.** 108 materialised
 * `dialog_create` views because a dialog is an allowlist the registry cannot
 * express per-field; here the registry CAN express it — `showInDialogs` is
 * declared on all 24 build fields at creation time (§1.6), leaving exactly four
 * in the dialog (number, part, quantityPlanned, notes). And a hidden def with
 * zero rows has nothing to list, so a seeded table view would be the kind of
 * thing that grows a "create" button.
 *
 * 🛑 `showInDialogs` on a materialised field lives in the `options` JSONB
 * written HERE, at field-creation time — `ensureCustomFields` skips a field
 * that already exists and never touches its options. Getting it wrong costs a
 * second migration; `031-documents-field-hidden-in-dialogs` and
 * `033-external-id-field-hidden-in-dialogs` are two that exist only to do that.
 *
 * **No DDL and no Drizzle migration.** `EntityDefinition.entityType` is a
 * `text()` column, so a new entity type is this migration plus hand-edits to
 * `enums.ts` (`ModelTypeValues` / `ModelTypes` / `ModelTypeMeta`),
 * `enum-values.ts`, `field-registry.ts`, `create-fields.ts`, `constants.ts`,
 * `types/resource/utils.ts` and the system-attribute union. If a `.sql` file
 * appears under `packages/database/drizzle/` for this work, something is wrong.
 *
 * Note the id space is shared across `data-migrations/migrations/` and
 * `seed/entity-migrations/migrations/` — 109 was the next free number counted
 * across BOTH (it has already collided once, at 103).
 *
 * Idempotent — every helper is insert-only or skips existing rows, and
 * `linkNewRelationships` only writes an `inverseResourceFieldId` that is null.
 */
export const migration109BuildAndStandardCost: EntityMigration = {
  id: '109-build-and-standard-cost',
  description:
    'Add the inert build system entity, the five frozen part_standard_* cost fields, ' +
    'stock_movement build provenance and qtyPerUnit, and order cancelledAt plus the build ' +
    'inverses',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // `stock_movement` is the core dependency: it is seeded by migration 002 and
    // is what a build actually writes. An org that has not reached 002 is
    // skipped rather than failed — 002 seeds the full registry, so it picks up
    // the two new movement fields itself, and a later run of this migration
    // adds the build def.
    const smDef = existing.entityDefs.get('stock_movement')
    if (!smDef) return { ...state, alreadyUpToDate: true }

    // ── Step 1: the `build` EntityDefinition ───────────────────────────
    // Visibility comes from `SYSTEM_ENTITIES`, which carried `isVisible: false`
    // when this shipped and carries `true` since phase 2 landed the UI. An org
    // that ran this migration before then keeps the `false` it was seeded with
    // — `ensureEntityDefinitions` never revisits an existing row — which is what
    // migration 110-build-visible exists to correct.
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )

    // Pull the incumbent defs into the id map so `linkNewRelationships` can
    // resolve BOTH directions of every pair in the single pass below. A def that
    // is absent simply contributes nothing.
    for (const entityType of EXISTING_TYPES) {
      const def = existing.entityDefs.get(entityType)
      if (def) entityDefIds.set(entityType, def.id)
    }

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
    >()
    const merge = (m: typeof allFieldMaps) => {
      for (const [k, v] of m) allFieldMaps.set(k, v)
    }

    // ── Step 2: the full BUILD_FIELDS registry ─────────────────────────
    const buildDefId = entityDefIds.get('build')
    if (buildDefId) {
      merge(
        await ensureCustomFields(
          db,
          organizationId,
          'build',
          buildDefId,
          BUILD_FIELDS,
          existing,
          state
        )
      )
    }

    // ── Step 3: the added fields on part, stock_movement and order ─────
    const registries: Record<(typeof EXISTING_TYPES)[number], Record<string, ResourceField>> = {
      part: PART_FIELDS,
      stock_movement: STOCK_MOVEMENT_FIELDS,
      order: ORDER_FIELDS,
    }

    for (const entityType of EXISTING_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const fields: Record<string, ResourceField> = {}
      for (const key of INCUMBENT_FIELD_KEYS[entityType]) {
        const field = registries[entityType][key]
        // Loud rather than silent: a renamed registry key would otherwise make
        // this migration quietly create one field fewer than it claims to.
        if (!field) {
          throw new Error(`${entityType} registry is missing the key "${key}" (migration 109)`)
        }
        fields[key] = field
      }
      merge(
        await ensureCustomFields(db, organizationId, entityType, defId, fields, existing, state)
      )
    }

    // ── Step 4: link relationships and display fields ──────────────────
    // One call, and every edge resolves — see the "Why this is ONE migration"
    // note above. `build.reversalOf` / `build.reversedBy` are a SELF-relation
    // pair carrying no `relationship.inverseResourceFieldId`, exactly like
    // `stock_movement.parentMovement` / `childMovements`, so the linker skips
    // them by design and the seeder materialises them from `relationshipConfig`.
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, [...NEW_TYPES], entityDefIds, allFieldMaps)

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0

    // New definitions and fields are invisible to every read path until the
    // per-org caches that serve them are dropped. `runEntityMigrationsForOrg`
    // does this after the whole batch, but `up()` can also be invoked directly,
    // so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 109 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}

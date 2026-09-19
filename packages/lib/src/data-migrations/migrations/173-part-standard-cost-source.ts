// packages/lib/src/data-migrations/migrations/173-part-standard-cost-source.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:173')

const PART_ENTITY_TYPE = 'part'
const STOCK_MOVEMENT_ENTITY_TYPE = 'stock_movement'
const MOVEMENT_TYPE_ATTRIBUTE = 'stock_movement_type'

/**
 * The eleventh `stock_movement_type`, as a LITERAL.
 *
 * `ensureCustomFields` never updates an existing field's options, so a registry
 * edit reaches fresh orgs only; every org that already has the def needs the
 * option appended or `UnifiedCrudHandler` refuses the roll's revaluation write.
 * Literal rather than read from `StockMovementType.values` for the reason 148
 * gives: a stored option list is data, and an import that follows the constant
 * would rewrite itself whenever the constant moved.
 */
const REVALUE_OPTION = { value: 'revalue', label: 'Revaluation', color: 'gray' } as const

/** Resolved out of {@link PART_FIELDS}, so the stored field cannot disagree with a fresh org's. */
const NEW_FIELD_KEYS = ['standardCostSource'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 173: a part's frozen standard learns where it came from
 * (`plans/accounting/tasks/73-the-buy-side-against-the-ledger.md` §6.4).
 *
 * ## What it adds
 *
 * **`stock_movement_type` gains `revalue`** — the cost-only movement the roll's
 * revaluation and the provisional replace both write: quantity 0, a signed
 * extended cost, one `inventory_movement` entry of kind `revalue` (§6.2 rule 2).
 *
 * **`part_standard_cost_source`**, SINGLE_SELECT (`provisional` | `confirmed`),
 * nullable. `ensureStandardCost` stamps `provisional` for a typed supplier
 * price, a typed opening cost or a manual roll, and `confirmed` for a receipt;
 * `rollStandardCost` carries a buildable's up from its children. The first
 * receipt of a `provisional` part REPLACES its standard with the agreed price
 * and revalues whatever is on hand, instead of posting a purchase price
 * variance that only says our guess was wrong.
 *
 * ## No backfill, deliberately
 *
 * Every part rolled before today keeps a NULL source, and NULL is read as
 * "predates the field" rather than as `provisional`
 * (`costing/client.ts:resolveStandardCostSource`). Guessing backwards is the
 * one thing that could go wrong here: a part stamped `provisional` by a
 * backfill would have its agreed standard silently replaced by its next
 * receipt. A person who wants the bootstrap behaviour clears the standard and
 * lets `ensureStandardCost` set it again.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 173-part-standard-cost-source`.
 */
export const migration173PartStandardCostSource: PerOrgMigration = {
  id: '173-part-standard-cost-source',
  description:
    "Adds the 'revalue' stock_movement_type option and part.standardCostSource (SINGLE_SELECT " +
    'provisional | confirmed) - whether the frozen standard is a typed guess or came off a ' +
    'receipt. No backfill: a NULL source means the standard predates the field and is never ' +
    'replaced (73 §6.2 rule 2, §6.4)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // (a) The eleventh movement type, appended to whatever the org stores.
    const movementDef = existing.entityDefs.get(STOCK_MOVEMENT_ENTITY_TYPE)
    let optionAdded = false
    if (movementDef) {
      const typeField = [...existing.fields.values()].find(
        (field) =>
          field.entityDefinitionId === movementDef.id &&
          field.systemAttribute === MOVEMENT_TYPE_ATTRIBUTE
      )
      const stored = typeField?.options as { options?: { value: string }[] } | null
      const currentOptions = stored?.options ?? []
      if (typeField && !currentOptions.some((option) => option.value === REVALUE_OPTION.value)) {
        await db
          .update(schema.CustomField)
          .set({
            options: { ...(stored ?? {}), options: [...currentOptions, REVALUE_OPTION] },
            updatedAt: new Date(),
          })
          .where(eq(schema.CustomField.id, typeField.id))
        optionAdded = true
      }
    }

    // (b) The source field on `part`.
    const partDef = existing.entityDefs.get(PART_ENTITY_TYPE)
    if (!partDef) return { ...state, alreadyUpToDate: !optionAdded }

    const fields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = PART_FIELDS[key]
      if (!field) {
        throw new Error(`part-fields registry is missing the key "${key}" (migration 173)`)
      }
      fields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      PART_ENTITY_TYPE,
      partDef.id,
      fields,
      existing,
      state
    )

    const changed = optionAdded || state.fieldsCreated > 0
    if (changed) {
      // Both writes bypass the org cache and `UnifiedCrudHandler` resolves a
      // field's shape from it, so a stale entry would keep refusing the
      // `revalue` option and dropping every write to the source field.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 173 applied', {
        organizationId,
        revalueOptionAdded: optionAdded,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

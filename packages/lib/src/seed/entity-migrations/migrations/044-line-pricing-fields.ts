// packages/lib/src/seed/entity-migrations/migrations/044-line-pricing-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { setValueWithType } from '../../../field-values/field-value-mutations'
import { CATALOG_ITEM_FIELDS } from '../../../resources/registry/resources/catalog-item-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:044')

/** Matches `CATALOG_CATEGORY_OPTIONS`' new entry (catalog-item-fields.ts) — kept in sync by hand. */
const LABOR_CATEGORY_OPTION = { label: 'Labor', value: 'labor', color: 'green' } as const

/**
 * Migration 044: registry fields for money plans 13 (unit-based pricing), 17 (part markup
 * pricing), and 18 (optional line items) — one shared migration (18 §8) since all three land
 * together.
 *
 * Fresh orgs get every field and the `labor` category option for free via the registries
 * (`LINE_ITEM_FIELDS`/`CATALOG_ITEM_FIELDS`/`CATALOG_CATEGORY_OPTIONS`) through the normal
 * `EntitySeeder` path — this migration only backfills orgs that installed `line_item`/
 * `catalog_item` (032/035) before these fields existed:
 *
 * 1. `line_item`: adds `unit`, `optional`, `optionalSelected`.
 * 2. `catalog_item`: adds `defaultUnit`, `cost`, `markup`.
 * 3. Both existing category fields (`catalog_item_category`, `line_item_category`) get the
 *    `labor` option merged in — org-added options are preserved (037's recipe: `ensureCustomFields`
 *    never touches an existing field's options).
 * 4. Cost backfill (plan 17 §5): part-linked catalog items get `cost` populated directly from
 *    the linked part's current `part_cost`, so the feature is visible without waiting for the
 *    next BOM recalc. No `markup` backfill and therefore no price writes — existing prices are
 *    all hand-set by definition.
 */
export const migration044LinePricingFields: EntityMigration = {
  id: '044-line-pricing-fields',
  description: 'Add unit/markup/optional fields (money 13/17/18), labor category, cost backfill',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    let changed = false

    const lineItemDef = existing.entityDefs.get('line_item')
    const catalogItemDef = existing.entityDefs.get('catalog_item')
    const partDef = existing.entityDefs.get('part')

    if (lineItemDef) {
      await ensureCustomFields(
        db,
        organizationId,
        'line_item',
        lineItemDef.id,
        {
          unit: LINE_ITEM_FIELDS.unit!,
          optional: LINE_ITEM_FIELDS.optional!,
          optionalSelected: LINE_ITEM_FIELDS.optionalSelected!,
        },
        existing,
        state
      )
    }

    let catalogFieldMap: Awaited<ReturnType<typeof ensureCustomFields>> | undefined
    if (catalogItemDef) {
      catalogFieldMap = await ensureCustomFields(
        db,
        organizationId,
        'catalog_item',
        catalogItemDef.id,
        {
          defaultUnit: CATALOG_ITEM_FIELDS.defaultUnit!,
          cost: CATALOG_ITEM_FIELDS.cost!,
          markup: CATALOG_ITEM_FIELDS.markup!,
        },
        existing,
        state
      )
    }

    // Category options: merge `labor` into both category fields without discarding any
    // org-extended options already present.
    for (const [def, systemAttribute] of [
      [catalogItemDef, 'catalog_item_category'],
      [lineItemDef, 'line_item_category'],
    ] as const) {
      if (!def) continue
      const field = existing.fields.get(fieldKey(def.id, systemAttribute))
      if (!field) continue

      const currentOptions =
        (field.options as { options?: Array<{ value: string }> })?.options ?? []
      const hasLabor = currentOptions.some((o) => o.value === 'labor')
      if (hasLabor) continue

      await db
        .update(schema.CustomField)
        .set({
          options: {
            ...(field.options as Record<string, unknown>),
            options: [...currentOptions, LABOR_CATEGORY_OPTION],
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.CustomField.id, field.id))

      changed = true
      logger.info('Migration 044 added labor category option', {
        organizationId,
        systemAttribute,
      })
    }

    // Cost backfill (plan 17 §5): part-linked catalog items get `cost` populated directly.
    if (catalogItemDef && partDef && catalogFieldMap) {
      const catalogPartField = existing.fields.get(fieldKey(catalogItemDef.id, 'catalog_item_part'))
      const catalogCostField = catalogFieldMap.get('catalog_item:cost')
      const partCostField = existing.fields.get(fieldKey(partDef.id, 'part_cost'))

      if (catalogPartField && catalogCostField && partCostField) {
        const linkRows = await db
          .select({
            catalogItemId: schema.FieldValue.entityId,
            partId: schema.FieldValue.relatedEntityId,
          })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, catalogPartField.id)
            )
          )

        const partIdByCatalogItemId = new Map(
          linkRows
            .filter((r): r is { catalogItemId: string; partId: string } => r.partId != null)
            .map((r) => [r.catalogItemId, r.partId])
        )

        if (partIdByCatalogItemId.size > 0) {
          const partIds = [...new Set(partIdByCatalogItemId.values())]
          const catalogItemIds = [...partIdByCatalogItemId.keys()]

          const [partCostRows, catalogCostRows] = await Promise.all([
            db
              .select({ entityId: schema.FieldValue.entityId, cost: schema.FieldValue.valueNumber })
              .from(schema.FieldValue)
              .where(
                and(
                  eq(schema.FieldValue.organizationId, organizationId),
                  eq(schema.FieldValue.fieldId, partCostField.id),
                  inArray(schema.FieldValue.entityId, partIds)
                )
              ),
            db
              .select({ entityId: schema.FieldValue.entityId, cost: schema.FieldValue.valueNumber })
              .from(schema.FieldValue)
              .where(
                and(
                  eq(schema.FieldValue.organizationId, organizationId),
                  eq(schema.FieldValue.fieldId, catalogCostField.id),
                  inArray(schema.FieldValue.entityId, catalogItemIds)
                )
              ),
          ])

          const partCostById = new Map(
            partCostRows.filter((r) => r.cost != null).map((r) => [r.entityId, r.cost as number])
          )
          const catalogCostById = new Map(
            catalogCostRows.filter((r) => r.cost != null).map((r) => [r.entityId, r.cost as number])
          )

          const ctx = createFieldValueContext(organizationId, undefined, db)
          let backfilled = 0

          for (const [catalogItemId, partId] of partIdByCatalogItemId.entries()) {
            const partCost = partCostById.get(partId)
            if (partCost == null) continue

            const currentCost = catalogCostById.get(catalogItemId)
            if (currentCost != null && currentCost === partCost) continue

            const recordId = toRecordId(catalogItemDef.id, catalogItemId) as RecordId
            await setValueWithType(ctx, {
              recordId,
              fieldId: catalogCostField.id,
              fieldType: catalogCostField._fieldDef.fieldType!,
              value: { type: 'number', value: partCost },
            })
            backfilled++
          }

          if (backfilled > 0) {
            changed = true
            logger.info('Migration 044 backfilled catalog item cost', {
              organizationId,
              backfilled,
            })
          }
        }
      }
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && !changed
    if (!alreadyUpToDate) {
      logger.info('Migration 044 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}

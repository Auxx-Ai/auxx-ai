// packages/lib/src/seed/entity-migrations/migrations/003-bom-stock-movement-fields.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { ensureCustomFields, fieldKey, linkNewRelationships, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

/**
 * Migration 003: Add BOM-aware stock movement fields
 *
 * - stock_movement_adjust_subparts (CHECKBOX) — flag to trigger BOM explosion
 * - stock_movement_parent_movement (RELATIONSHIP → stock_movement) — links children to parent
 * - stock_movement_child_movements (inverse RELATIONSHIP — has_many)
 * - 'sale' option added to stock_movement_type
 */
export const migration003BomStockMovementFields: EntityMigration = {
  id: '003-bom-stock-movement-fields',
  description:
    'Add adjust_subparts + parent_movement fields to stock_movement, add sale type option',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const smDef = existing.entityDefs.get('stock_movement')
    if (!smDef) {
      // stock_movement doesn't exist yet — 002 hasn't run. Skip.
      return { ...state, alreadyUpToDate: true }
    }

    const entityDefIds = new Map<string, string>()
    entityDefIds.set('stock_movement', smDef.id)

    // ── Step 1: Ensure new fields ──
    const newFieldKeys = ['adjustSubparts', 'parentMovement', 'childMovements']
    const newFields = Object.fromEntries(
      Object.entries(STOCK_MOVEMENT_FIELDS).filter(([key]) => newFieldKeys.includes(key))
    )

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: any; _fieldDef: any }
    >()

    const smFields = await ensureCustomFields(
      db,
      organizationId,
      'stock_movement',
      smDef.id,
      newFields,
      existing,
      state
    )
    for (const [k, v] of smFields) allFieldMaps.set(k, v)

    // Load existing stock_movement fields into map for inverse relationship lookup
    for (const field of existing.fields.values()) {
      if (field.entityDefinitionId !== smDef.id) continue
      const smField = Object.values(STOCK_MOVEMENT_FIELDS).find(
        (f) => f.systemAttribute === field.systemAttribute
      )
      if (smField) {
        const key = `stock_movement:${smField.id}`
        if (!allFieldMaps.has(key)) {
          allFieldMaps.set(key, {
            id: field.id,
            systemAttribute: field.systemAttribute,
            options: field.options,
            _fieldDef: smField,
          })
        }
      }
    }

    // ── Step 2: Link self-referential relationship ──
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    // ── Step 3: Add 'sale' option to stock_movement_type ──
    const typeField = existing.fields.get(fieldKey(smDef.id, 'stock_movement_type'))
    if (typeField) {
      const currentOptions = (typeField.options as any)?.options ?? []
      const hasSale = currentOptions.some((o: any) => o.value === 'sale')
      if (!hasSale) {
        const updatedOptions = [
          ...currentOptions,
          { value: 'sale', label: 'Sale', color: 'indigo' },
        ]
        await db
          .update(schema.CustomField)
          .set({
            options: { ...typeField.options, options: updatedOptions },
            updatedAt: new Date(),
          })
          .where(eq(schema.CustomField.id, typeField.id))
      }
    }

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0
    return { ...state, alreadyUpToDate }
  },
}

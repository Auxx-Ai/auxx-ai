// packages/lib/src/seed/entity-migrations/migrations/002-stock-movement-inventory.ts

import type { Database } from '@auxx/database'
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

/**
 * Migration 002: Add stock_movement entity + inventory fields on part
 *
 * - stock_movement entity with 7 fields (part, type, quantity, reason, reference, createdAt, createdBy)
 * - New part fields: quantityOnHand, stockStatus, reorderPoint, reorderQty, stockMovements
 */
export const migration002StockMovement: EntityMigration = {
  id: '002-stock-movement-inventory',
  description: 'Add stock_movement entity and inventory fields on part',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // ── Step 1: Ensure stock_movement EntityDefinition ──
    const entitiesToEnsure = SYSTEM_ENTITIES.filter((e) => e.entityType === 'stock_movement')
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      entitiesToEnsure,
      existing,
      state
    )

    // Also need part def ID for new fields
    const partDef = existing.entityDefs.get('part')
    if (partDef) entityDefIds.set('part', partDef.id)

    // ── Step 2: Ensure CustomFields ──
    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: any; _fieldDef: any }
    >()

    // stock_movement fields
    const smDefId = entityDefIds.get('stock_movement')
    if (smDefId) {
      const smFields = await ensureCustomFields(
        db,
        organizationId,
        'stock_movement',
        smDefId,
        STOCK_MOVEMENT_FIELDS,
        existing,
        state
      )
      for (const [k, v] of smFields) allFieldMaps.set(k, v)
    }

    // New part inventory fields
    const partDefId = entityDefIds.get('part')
    if (partDefId) {
      const newPartFieldKeys = [
        'quantityOnHand',
        'stockStatus',
        'reorderPoint',
        'reorderQty',
        'stockMovements',
      ]
      const newPartFields = Object.fromEntries(
        Object.entries(PART_FIELDS).filter(([key]) => newPartFieldKeys.includes(key))
      )
      const partFields = await ensureCustomFields(
        db,
        organizationId,
        'part',
        partDefId,
        newPartFields,
        existing,
        state
      )
      for (const [k, v] of partFields) allFieldMaps.set(k, v)

      // Load existing part fields into map for inverse relationship lookup
      for (const field of existing.fields.values()) {
        if (field.entityDefinitionId !== partDefId) continue
        const partField = Object.values(PART_FIELDS).find(
          (f) => f.systemAttribute === field.systemAttribute
        )
        if (partField) {
          const key = `part:${partField.id}`
          if (!allFieldMaps.has(key)) {
            allFieldMaps.set(key, {
              id: field.id,
              systemAttribute: field.systemAttribute,
              options: field.options,
              _fieldDef: partField,
            })
          }
        }
      }
    }

    // ── Step 3: Link relationships ──
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    // ── Step 4: Link display fields for stock_movement ──
    await linkDisplayFields(db, ['stock_movement'], entityDefIds, allFieldMaps)

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0
    return { ...state, alreadyUpToDate }
  },
}

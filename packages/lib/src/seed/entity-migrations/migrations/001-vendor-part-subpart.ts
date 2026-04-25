// packages/lib/src/seed/entity-migrations/migrations/001-vendor-part-subpart.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { SUBPART_FIELDS } from '../../../resources/registry/resources/subpart-fields'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  ensureFieldViews,
  fieldKey,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:001')

/**
 * Migration 001: Add vendor_part and subpart entities + new part/contact fields
 *
 * Covers everything added in PRs #384 and #390:
 * - vendor_part entity with 12 fields
 * - subpart entity with 5 fields
 * - New part fields: part_unit_price, part_cost (renamed from 'cost'), reverse rels
 * - New contact field: contact_vendor_parts reverse rel
 * - Rename: part cost systemAttribute 'cost' → 'part_cost'
 */
export const migration001VendorPartSubpart: EntityMigration = {
  id: '001-vendor-part-subpart',
  description: 'Add vendor_part and subpart entities, new part/contact fields, rename part cost',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // ── Step 0: Rename 'cost' → 'part_cost' on existing part cost field ──
    await renameCostAttribute(db, organizationId, existing)

    // Reload after rename so the field map is accurate
    const refreshedExisting = await loadExistingState(db, organizationId)

    // ── Step 1: Ensure EntityDefinitions ──
    const entitiesToEnsure = SYSTEM_ENTITIES.filter((e) =>
      ['vendor_part', 'subpart'].includes(e.entityType)
    )
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      entitiesToEnsure,
      refreshedExisting,
      state
    )

    // Also need part and contact def IDs for new fields on those entities
    const partDef = refreshedExisting.entityDefs.get('part')
    const contactDef = refreshedExisting.entityDefs.get('contact')
    if (partDef) entityDefIds.set('part', partDef.id)
    if (contactDef) entityDefIds.set('contact', contactDef.id)

    // ── Step 2: Ensure CustomFields ──
    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: any; _fieldDef: any }
    >()

    // vendor_part fields
    const vpDefId = entityDefIds.get('vendor_part')
    if (vpDefId) {
      const vpFields = await ensureCustomFields(
        db,
        organizationId,
        'vendor_part',
        vpDefId,
        VENDOR_PART_FIELDS,
        refreshedExisting,
        state
      )
      for (const [k, v] of vpFields) allFieldMaps.set(k, v)
    }

    // subpart fields
    const spDefId = entityDefIds.get('subpart')
    if (spDefId) {
      const spFields = await ensureCustomFields(
        db,
        organizationId,
        'subpart',
        spDefId,
        SUBPART_FIELDS,
        refreshedExisting,
        state
      )
      for (const [k, v] of spFields) allFieldMaps.set(k, v)
    }

    // New part fields (unitPrice, cost, reverse rels)
    const partDefId = entityDefIds.get('part')
    if (partDefId) {
      const newPartFieldKeys = ['unitPrice', 'cost', 'vendorParts', 'subparts', 'usedInAssemblies']
      const newPartFields = Object.fromEntries(
        Object.entries(PART_FIELDS).filter(([key]) => newPartFieldKeys.includes(key))
      )
      const partFields = await ensureCustomFields(
        db,
        organizationId,
        'part',
        partDefId,
        newPartFields,
        refreshedExisting,
        state
      )
      for (const [k, v] of partFields) allFieldMaps.set(k, v)
    }

    // New contact field (vendorParts reverse rel)
    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      const newContactFields = Object.fromEntries(
        Object.entries(CONTACT_FIELDS).filter(([key]) => key === 'vendorParts')
      )
      const contactFields = await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDefId,
        newContactFields,
        refreshedExisting,
        state
      )
      for (const [k, v] of contactFields) allFieldMaps.set(k, v)
    }

    // ── Step 3: Link relationships ──
    // Need all existing part/contact fields in the map too for inverse lookups
    if (partDefId) {
      for (const field of refreshedExisting.fields.values()) {
        if (field.entityDefinitionId !== partDefId) continue
        // Find matching field def by systemAttribute
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
    if (contactDefId) {
      for (const field of refreshedExisting.fields.values()) {
        if (field.entityDefinitionId !== contactDefId) continue
        const contactField = Object.values(CONTACT_FIELDS).find(
          (f) => f.systemAttribute === field.systemAttribute
        )
        if (contactField) {
          const key = `contact:${contactField.id}`
          if (!allFieldMaps.has(key)) {
            allFieldMaps.set(key, {
              id: field.id,
              systemAttribute: field.systemAttribute,
              options: field.options,
              _fieldDef: contactField,
            })
          }
        }
      }
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    // ── Step 4: Link display fields for new entities ──
    await linkDisplayFields(db, ['vendor_part', 'subpart'], entityDefIds, allFieldMaps)

    // ── Step 5: Create field views for vendor_part ──
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'vendor_part',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id', 'vendor_part_part'],
        },
        {
          entityType: 'vendor_part',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'vendor_part_part',
            'vendor_part_contact',
            'vendor_part_vendor_sku',
            'vendor_part_unit_price',
            'vendor_part_is_preferred',
          ],
        },
      ],
      entityDefIds,
      allFieldMaps
    )

    const alreadyUpToDate =
      state.entityDefsCreated === 0 && state.fieldsCreated === 0 && state.relationshipsLinked === 0
    return { ...state, alreadyUpToDate }
  },
}

/**
 * Rename the part cost field's systemAttribute from 'cost' to 'part_cost'.
 * No-op if already renamed or doesn't exist.
 */
async function renameCostAttribute(
  db: Database,
  organizationId: string,
  existing: Awaited<ReturnType<typeof loadExistingState>>
): Promise<void> {
  const partDefId = existing.entityDefs.get('part')?.id
  if (!partDefId) return

  // If 'part_cost' already exists on part, nothing to do
  if (existing.fields.has(fieldKey(partDefId, 'part_cost'))) return

  // If 'cost' exists on part, rename it
  const oldCostField = existing.fields.get(fieldKey(partDefId, 'cost'))
  if (!oldCostField) return

  await db
    .update(schema.CustomField)
    .set({ systemAttribute: 'part_cost', updatedAt: new Date() })
    .where(
      and(
        eq(schema.CustomField.id, oldCostField.id),
        eq(schema.CustomField.organizationId, organizationId)
      )
    )

  logger.info('Renamed part cost systemAttribute: cost → part_cost')
}

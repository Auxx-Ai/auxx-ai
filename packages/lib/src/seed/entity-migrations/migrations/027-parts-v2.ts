// packages/lib/src/seed/entity-migrations/migrations/027-parts-v2.ts

import { type Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toResourceFieldId } from '@auxx/types/field'
import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { FieldOptions } from '../../../custom-fields'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:027')

/**
 * Migration 027: Parts v2
 *
 * B) Supplier repoint — `vendor_part.contact` (slug `vendor_part_contact`) now
 *    targets the `company` entity instead of `contact`. Adds the
 *    `company_vendor_parts` reverse field, repoints the relationship, CLEARS the
 *    existing contact links (users re-add suppliers), and drops the now-unused
 *    `contact_vendor_parts` field.
 *
 * C) Category → inline TAGS — flips the part `category` CustomField from TEXT to
 *    the option-backed TAGS type in place, moves existing values from
 *    `valueText` → `optionId`, and seeds matching `options.options` entries so
 *    the moved values resolve in the picker. No global tag entity involved.
 */
export const migration027PartsV2: EntityMigration = {
  id: '027-parts-v2',
  description:
    'Repoint vendor_part supplier contact→company (clear links); convert part category TEXT→TAGS',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    let changed = false

    const existing = await loadExistingState(db, organizationId)
    const vendorPartDef = existing.entityDefs.get('vendor_part')
    const companyDef = existing.entityDefs.get('company')
    const partDef = existing.entityDefs.get('part')

    // ── B) Supplier: repoint vendor_part_contact contact → company ──
    if (vendorPartDef && companyDef) {
      // 1. Ensure the company reverse field (company_vendor_parts) exists.
      const companyFieldMap = await ensureCustomFields(
        db,
        organizationId,
        'company',
        companyDef.id,
        { vendorParts: COMPANY_FIELDS.vendorParts! },
        existing,
        state
      )
      const companyVpField = companyFieldMap.get(`company:${COMPANY_FIELDS.vendorParts!.id}`)

      const vpContactField = existing.fields.get(fieldKey(vendorPartDef.id, 'vendor_part_contact'))

      if (companyVpField && vpContactField) {
        const companyVpResourceId = toResourceFieldId(companyDef.id, companyVpField.id)
        const vpContactResourceId = toResourceFieldId(vendorPartDef.id, vpContactField.id)

        // 2a. Point the company reverse field back at vendor_part_contact (if unlinked).
        const companyRel = (companyVpField.options as FieldOptions)?.relationship
        if (companyRel?.inverseResourceFieldId !== vpContactResourceId) {
          await db
            .update(schema.CustomField)
            .set({
              options: {
                ...(companyVpField.options as FieldOptions),
                relationship: { ...companyRel, inverseResourceFieldId: vpContactResourceId },
              },
              updatedAt: new Date(),
            })
            .where(eq(schema.CustomField.id, companyVpField.id))
          state.relationshipsLinked++
          changed = true
        }

        // 2b. Repoint vendor_part_contact at the company reverse field (if not already).
        const vpRel = (vpContactField.options as FieldOptions)?.relationship
        if (vpRel?.inverseResourceFieldId !== companyVpResourceId) {
          await db
            .update(schema.CustomField)
            .set({
              name: 'Supplier',
              options: {
                ...(vpContactField.options as FieldOptions),
                relationship: { ...vpRel, inverseResourceFieldId: companyVpResourceId },
              },
              updatedAt: new Date(),
            })
            .where(eq(schema.CustomField.id, vpContactField.id))
          state.relationshipsLinked++
          changed = true
        }

        // 3. Clear stale links — rows still referencing non-company instances.
        //    Runs unconditionally (not gated on the repoint above) so a crash
        //    between the repoint and this delete self-repairs on retry; company
        //    links users add after the migration are untouched.
        const cleared = await db
          .delete(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, vpContactField.id),
              or(
                isNull(schema.FieldValue.relatedEntityDefinitionId),
                ne(schema.FieldValue.relatedEntityDefinitionId, companyDef.id)
              )
            )
          )
          .returning({ id: schema.FieldValue.id })
        if (cleared.length > 0) {
          changed = true
          logger.info('Cleared vendor_part supplier links', {
            organizationId,
            count: cleared.length,
          })
        }
      }

      // 4. Drop the now-unused contact_vendor_parts field + its values.
      const contactDef = existing.entityDefs.get('contact')
      if (contactDef) {
        const contactVpField = existing.fields.get(fieldKey(contactDef.id, 'contact_vendor_parts'))
        if (contactVpField) {
          await db
            .delete(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.organizationId, organizationId),
                eq(schema.FieldValue.fieldId, contactVpField.id)
              )
            )
          await db.delete(schema.CustomField).where(eq(schema.CustomField.id, contactVpField.id))
          changed = true
        }
      }
    }

    // ── C) Category: flip TEXT → inline TAGS + move values ──
    if (partDef) {
      const categoryField = existing.fields.get(fieldKey(partDef.id, 'category'))
      if (categoryField) {
        // 1. Flip the field type in place (idempotent: only touches non-TAGS rows).
        const flipped = await db
          .update(schema.CustomField)
          .set({
            type: FieldTypeEnum.TAGS,
            options: {
              ...(categoryField.options as FieldOptions),
              options: (categoryField.options as FieldOptions)?.options ?? [],
            },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.CustomField.id, categoryField.id),
              ne(schema.CustomField.type, FieldTypeEnum.TAGS)
            )
          )
          .returning({ id: schema.CustomField.id })
        if (flipped.length > 0) changed = true

        // 2. Move existing values: valueText → optionId (idempotent).
        const moved = await db
          .update(schema.FieldValue)
          .set({ optionId: sql`${schema.FieldValue.valueText}`, valueText: null })
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, categoryField.id),
              isNotNull(schema.FieldValue.valueText),
              ne(schema.FieldValue.valueText, ''),
              isNull(schema.FieldValue.optionId)
            )
          )
          .returning({ id: schema.FieldValue.id })
        if (moved.length > 0) {
          changed = true
          logger.info('Moved category values to tags', { organizationId, count: moved.length })
        }

        // 3. Seed option entries for the moved values (idempotent: derived from
        //    the current optionIds, not just this run's moves). Without a matching
        //    `options.options` entry the picker treats a value as orphaned — it
        //    never shows as a suggestion and the first edit of the field silently
        //    drops it. Raw text as `value` matches what step 2 put in optionId.
        const valueRows = await db
          .selectDistinct({ optionId: schema.FieldValue.optionId })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, organizationId),
              eq(schema.FieldValue.fieldId, categoryField.id),
              isNotNull(schema.FieldValue.optionId),
              ne(schema.FieldValue.optionId, '')
            )
          )
        const currentOptions = (categoryField.options as FieldOptions)?.options ?? []
        const known = new Set(currentOptions.flatMap((o) => (o.id ? [o.id, o.value] : [o.value])))
        const missing = valueRows
          .map((r) => r.optionId)
          .filter((v): v is string => v != null && !known.has(v))
        if (missing.length > 0) {
          await db
            .update(schema.CustomField)
            .set({
              options: {
                ...(categoryField.options as FieldOptions),
                options: [...currentOptions, ...missing.map((v) => ({ label: v, value: v }))],
              },
              updatedAt: new Date(),
            })
            .where(eq(schema.CustomField.id, categoryField.id))
          changed = true
          logger.info('Seeded category tag options', { organizationId, count: missing.length })
        }
      }
    }

    const alreadyUpToDate = !changed && state.fieldsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 027 applied', { organizationId, ...state })
    }
    return { ...state, alreadyUpToDate }
  },
}

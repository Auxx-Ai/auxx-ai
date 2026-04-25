// packages/lib/src/seed/entity-migrations/migrations/004-company.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { ENTITY_INSTANCE_COLUMNS, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { shouldCreateField } from '../../entity-seeder/utils'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  ensureFieldViews,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:004')

// ─── Template field ID → system attribute mapping ────────────────────
// Template-installed companies store the template field ID (e.g. 'companyName')
// as the CustomField's systemAttribute. This map translates those to the
// canonical system attribute values so the existing fields get recognized
// by ensureCustomFields and don't get duplicated.

const TEMPLATE_FIELD_TO_SYSTEM_ATTR: Record<string, string> = {
  companyName: 'company_name',
  logo: 'company_logo',
  website: 'company_website',
  industry: 'company_industry',
  companySize: 'company_size',
  annualRevenue: 'company_annual_revenue',
  founded: 'company_founded',
  headquarters: 'company_headquarters',
  notes: 'company_notes',
  primaryContact: 'company_primary_contact',
  employees: 'company_employees',
}

// Build a reverse lookup: lowercase field label → system attribute + field type
// Used as a fallback for user-created fields that have no systemAttribute.
const LABEL_TYPE_TO_SYSTEM_ATTR = new Map<string, { systemAttribute: string; fieldType: string }>()
for (const field of Object.values(COMPANY_FIELDS)) {
  if (!field.systemAttribute || !field.fieldType) continue
  if (!shouldCreateField(field, ENTITY_INSTANCE_COLUMNS)) continue
  LABEL_TYPE_TO_SYSTEM_ATTR.set(`${field.label.toLowerCase()}::${field.fieldType}`, {
    systemAttribute: field.systemAttribute,
    fieldType: field.fieldType,
  })
}

/**
 * Detect and upgrade a pre-existing company entity (template-installed or
 * user-created) so that the rest of the migration treats it as a system entity.
 *
 * After this runs, `loadExistingState()` will see it via `entityType = 'company'`,
 * and `ensureCustomFields` will recognize matched fields by their systemAttribute.
 */
async function upgradeExistingCompanyEntity(db: Database, organizationId: string): Promise<void> {
  // Find a non-system company entity by slug or name
  const [existing] = await db
    .select({
      id: schema.EntityDefinition.id,
      apiSlug: schema.EntityDefinition.apiSlug,
      singular: schema.EntityDefinition.singular,
    })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        isNull(schema.EntityDefinition.entityType),
        isNull(schema.EntityDefinition.archivedAt),
        or(
          eq(schema.EntityDefinition.apiSlug, 'companies'),
          sql`lower(${schema.EntityDefinition.singular}) = 'company'`
        )
      )
    )
    .limit(1)

  if (!existing) return

  logger.info('Found pre-existing company entity, upgrading to system entity', {
    organizationId,
    entityDefinitionId: existing.id,
    apiSlug: existing.apiSlug,
    singular: existing.singular,
  })

  // ── Upgrade EntityDefinition ──
  const now = new Date()
  await db
    .update(schema.EntityDefinition)
    .set({
      entityType: 'company',
      apiSlug: 'companies',
      singular: 'Company',
      plural: 'Companies',
      icon: 'building-2',
      color: 'blue',
      updatedAt: now,
    })
    .where(eq(schema.EntityDefinition.id, existing.id))

  // ── Upgrade CustomFields ──
  const existingFields = await db
    .select({
      id: schema.CustomField.id,
      name: schema.CustomField.name,
      type: schema.CustomField.type,
      systemAttribute: schema.CustomField.systemAttribute,
    })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, existing.id)
      )
    )

  let fieldsUpgraded = 0
  for (const field of existingFields) {
    let newSystemAttribute: string | undefined

    // Strategy 1: Match by template field ID stored in systemAttribute
    if (field.systemAttribute && TEMPLATE_FIELD_TO_SYSTEM_ATTR[field.systemAttribute]) {
      newSystemAttribute = TEMPLATE_FIELD_TO_SYSTEM_ATTR[field.systemAttribute]
    }

    // Strategy 2: Fallback — match by label + field type
    if (!newSystemAttribute && field.name && field.type) {
      const key = `${field.name.toLowerCase()}::${field.type}`
      const match = LABEL_TYPE_TO_SYSTEM_ATTR.get(key)
      if (match) {
        newSystemAttribute = match.systemAttribute
      }
    }

    if (newSystemAttribute) {
      await db
        .update(schema.CustomField)
        .set({
          systemAttribute: newSystemAttribute as SystemAttribute,
          modelType: 'company',
          isCustom: false,
          updatedAt: now,
        })
        .where(eq(schema.CustomField.id, field.id))
      fieldsUpgraded++
    }
  }

  logger.info('Upgraded pre-existing company entity', {
    organizationId,
    entityDefinitionId: existing.id,
    fieldsUpgraded,
    totalFields: existingFields.length,
  })
}

/**
 * Migration 004: Add company as a system entity
 *
 * - Detects and upgrades pre-existing company entities (template or user-created)
 * - Creates company EntityDefinition (if not already present)
 * - Seeds all company CustomFields (name, logo, website, industry, size, revenue, etc.)
 * - Adds reverse relationship fields on contact (company, employer)
 * - Links relationships between company and contact
 * - Sets display fields and creates default field views
 */
export const migration004Company: EntityMigration = {
  id: '004-company',
  description: 'Add company as a system entity with contact relationships',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    // ── Step 0: Upgrade pre-existing company entity if present ──
    await upgradeExistingCompanyEntity(db, organizationId)

    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // ── Step 1: Ensure EntityDefinition for company ──
    const entitiesToEnsure = SYSTEM_ENTITIES.filter((e) => e.entityType === 'company')
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      entitiesToEnsure,
      existing,
      state
    )

    // Also need contact def ID for new reverse fields
    const contactDef = existing.entityDefs.get('contact')
    if (contactDef) entityDefIds.set('contact', contactDef.id)

    // ── Step 2: Ensure CustomFields ──
    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: any; _fieldDef: any }
    >()

    // Company fields
    const companyDefId = entityDefIds.get('company')
    if (companyDefId) {
      const companyFields = await ensureCustomFields(
        db,
        organizationId,
        'company',
        companyDefId,
        COMPANY_FIELDS,
        existing,
        state
      )
      for (const [k, v] of companyFields) allFieldMaps.set(k, v)
    }

    // New contact reverse relationship fields (company, employer)
    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      const newContactFields = Object.fromEntries(
        Object.entries(CONTACT_FIELDS).filter(([key]) => ['company', 'employer'].includes(key))
      )
      const contactFields = await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDefId,
        newContactFields,
        existing,
        state
      )
      for (const [k, v] of contactFields) allFieldMaps.set(k, v)
    }

    // ── Step 3: Load existing contact fields into allFieldMaps for inverse resolution ──
    if (contactDefId) {
      for (const field of existing.fields.values()) {
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

    // ── Step 4: Link relationships ──
    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)

    // ── Step 5: Link display fields for company ──
    await linkDisplayFields(db, ['company'], entityDefIds, allFieldMaps)

    // ── Step 6: Create field views ──
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'company',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'company',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id', 'company_logo'],
        },
        {
          entityType: 'company',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'company_name',
            'company_website',
            'company_industry',
            'company_primary_contact',
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

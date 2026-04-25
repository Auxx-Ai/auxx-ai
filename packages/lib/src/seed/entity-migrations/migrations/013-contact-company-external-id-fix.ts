// packages/lib/src/seed/entity-migrations/migrations/013-contact-company-external-id-fix.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, inArray } from 'drizzle-orm'
import type { ResourceField } from '../../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { buildFieldOptions, mapCapabilities } from '../../entity-seeder/utils'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:013')

/**
 * Migration 013: Repair migration 011.
 *
 * Migration 011 silently no-op'd on every org because the shared
 * `loadExistingState` helper keys the `existing.fields` Map by
 * `systemAttribute` alone. The Thread entity already had a
 * `systemAttribute = 'external_id'` CustomField from baseline seeding,
 * so when 011 asked "does external_id exist on contact?" the lookup
 * returned Thread's row, `ensureCustomFields` short-circuited, and
 * no contact/company external_id field was ever created.
 *
 * Side effect: extension writes against contact/company external_id
 * were routed to Thread's field id, producing FieldValue rows whose
 * `entityDefinitionId` (contact/company) does not match the field's
 * own `entityDefinitionId` (thread).
 *
 * This migration:
 *   1. Creates the missing contact + company external_id CustomFields
 *      with `options.multi: true` from the registry.
 *   2. Re-points misrouted FieldValue rows at the new field ids.
 *
 * Idempotent: skips creation if the correctly-scoped field already
 * exists, skips repointing when no misrouted rows remain.
 */
export const migration013ContactCompanyExternalIdFix: EntityMigration = {
  id: '013-contact-company-external-id-fix',
  description: 'Repair missing contact/company external_id fields from migration 011',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const entityDefs = await db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const defIdByType = new Map(entityDefs.map((d) => [d.entityType, d.id]))
    const contactDefId = defIdByType.get('contact')
    const companyDefId = defIdByType.get('company')
    const threadDefId = defIdByType.get('thread')

    const contactFieldId = contactDefId
      ? await ensureExternalIdField(
          db,
          organizationId,
          contactDefId,
          'contact',
          CONTACT_FIELDS.externalId!,
          state
        )
      : null
    const companyFieldId = companyDefId
      ? await ensureExternalIdField(
          db,
          organizationId,
          companyDefId,
          'company',
          COMPANY_FIELDS.externalId!,
          state
        )
      : null

    let repointed = 0
    if (threadDefId) {
      const [threadExtId] = await db
        .select({ id: schema.CustomField.id })
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, threadDefId),
            eq(schema.CustomField.systemAttribute, 'external_id')
          )
        )
        .limit(1)

      if (threadExtId) {
        repointed += await repointMisroutedFieldValues(
          db,
          organizationId,
          threadExtId.id,
          contactDefId,
          contactFieldId
        )
        repointed += await repointMisroutedFieldValues(
          db,
          organizationId,
          threadExtId.id,
          companyDefId,
          companyFieldId
        )
      }
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && repointed === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 013 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
        fieldValueRowsRepointed: repointed,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}

async function ensureExternalIdField(
  db: Database,
  organizationId: string,
  entityDefId: string,
  entityType: 'contact' | 'company',
  field: ResourceField,
  state: { fieldsCreated: number }
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, entityDefId),
        eq(schema.CustomField.systemAttribute, 'external_id')
      )
    )
    .limit(1)

  if (existing) return existing.id

  const [created] = await db
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId: entityDefId,
      modelType: entityType,
      name: field.label,
      type: field.fieldType!,
      description: field.description,
      systemAttribute: field.systemAttribute as SystemAttribute,
      sortOrder: field.systemSortOrder ?? 'a0',
      options: buildFieldOptions(field),
      isCustom: false,
      updatedAt: new Date(),
      ...mapCapabilities(field.capabilities),
    })
    .returning({ id: schema.CustomField.id })

  if (!created) throw new Error(`Failed to create ${entityType} external_id CustomField`)

  state.fieldsCreated++
  logger.debug(`Created ${entityType} external_id CustomField`, { id: created.id, organizationId })
  return created.id
}

/**
 * Move FieldValue rows whose `entityDefinitionId` is contact/company
 * but whose `fieldId` points at Thread's external_id field onto the
 * new correctly-scoped field id.
 */
async function repointMisroutedFieldValues(
  db: Database,
  organizationId: string,
  threadExtFieldId: string,
  targetEntityDefId: string | undefined,
  targetFieldId: string | null
): Promise<number> {
  if (!targetEntityDefId || !targetFieldId) return 0

  const misrouted = await db
    .select({ id: schema.FieldValue.id })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, threadExtFieldId),
        eq(schema.FieldValue.entityDefinitionId, targetEntityDefId)
      )
    )

  if (misrouted.length === 0) return 0

  await db
    .update(schema.FieldValue)
    .set({ fieldId: targetFieldId, updatedAt: new Date() })
    .where(
      inArray(
        schema.FieldValue.id,
        misrouted.map((r) => r.id)
      )
    )

  return misrouted.length
}

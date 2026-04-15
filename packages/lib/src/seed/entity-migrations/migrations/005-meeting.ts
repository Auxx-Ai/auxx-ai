// packages/lib/src/seed/entity-migrations/migrations/005-meeting.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { MEETING_FIELDS } from '../../../resources/registry/resources/meeting-fields'
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

/**
 * Logger for the Meeting entity migration.
 */
const logger = createScopedLogger('entity-migrations:005')

/**
 * Template field ID to canonical system attribute mapping for Meeting fields.
 */
const TEMPLATE_FIELD_TO_SYSTEM_ATTR: Record<string, string> = {
  title: 'meeting_title',
  type: 'meeting_type',
  dateTime: 'meeting_date_time',
  duration: 'meeting_duration_minutes',
  location: 'meeting_location',
  meetingUrl: 'meeting_url',
  organizer: 'meeting_organizer',
  agenda: 'meeting_agenda',
  meetingNotes: 'meeting_notes',
  actionItems: 'meeting_action_items',
  recordingUrl: 'meeting_recording_url',
  company: 'meeting_company',
  contact: 'meeting_contact',
}

/**
 * Fallback lookup from field label + type to canonical Meeting system attributes.
 */
const LABEL_TYPE_TO_SYSTEM_ATTR = new Map<string, { systemAttribute: string; fieldType: string }>()

for (const field of Object.values(MEETING_FIELDS)) {
  if (!field.systemAttribute || !field.fieldType) continue
  if (!shouldCreateField(field, ENTITY_INSTANCE_COLUMNS)) continue
  LABEL_TYPE_TO_SYSTEM_ATTR.set(`${field.label.toLowerCase()}::${field.fieldType}`, {
    systemAttribute: field.systemAttribute,
    fieldType: field.fieldType,
  })
}

/**
 * Upgrades inverse "Meetings" relationship fields that were created on Company or Contact
 * when the legacy Meeting template was installed.
 */
async function upgradeExistingMeetingInverseFields(
  db: Database,
  organizationId: string,
  meetingEntityDefinitionId: string,
  meetingFieldIds: { company?: string; contact?: string }
): Promise<void> {
  const inverseTargets = [
    {
      entityType: 'company',
      expectedSystemAttribute: 'company_meetings' as SystemAttribute,
      resourceFieldId: meetingFieldIds.company
        ? toResourceFieldId(meetingEntityDefinitionId, meetingFieldIds.company)
        : null,
    },
    {
      entityType: 'contact',
      expectedSystemAttribute: 'contact_meetings' as SystemAttribute,
      resourceFieldId: meetingFieldIds.contact
        ? toResourceFieldId(meetingEntityDefinitionId, meetingFieldIds.contact)
        : null,
    },
  ] as const

  const entityDefs = await db
    .select({
      id: schema.EntityDefinition.id,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        or(
          eq(schema.EntityDefinition.entityType, 'company'),
          eq(schema.EntityDefinition.entityType, 'contact')
        )
      )
    )

  const entityDefMap = new Map(
    entityDefs
      .filter(
        (entityDef): entityDef is { id: string; entityType: 'company' | 'contact' } =>
          entityDef.entityType === 'company' || entityDef.entityType === 'contact'
      )
      .map((entityDef) => [entityDef.entityType, entityDef.id])
  )

  const now = new Date()
  let upgradedCount = 0

  for (const inverseTarget of inverseTargets) {
    const entityDefinitionId = entityDefMap.get(inverseTarget.entityType)
    if (!entityDefinitionId || !inverseTarget.resourceFieldId) continue

    const existingFields = await db
      .select({
        id: schema.CustomField.id,
        type: schema.CustomField.type,
        systemAttribute: schema.CustomField.systemAttribute,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, entityDefinitionId)
        )
      )

    for (const field of existingFields) {
      const inverseResourceFieldId = (
        field.options as { relationship?: { inverseResourceFieldId?: ResourceFieldId | null } }
      )?.relationship?.inverseResourceFieldId

      if (field.type !== 'RELATIONSHIP') continue
      if (field.systemAttribute === inverseTarget.expectedSystemAttribute) continue
      if (inverseResourceFieldId !== inverseTarget.resourceFieldId) continue

      await db
        .update(schema.CustomField)
        .set({
          systemAttribute: inverseTarget.expectedSystemAttribute,
          modelType: inverseTarget.entityType,
          isCustom: false,
          updatedAt: now,
        })
        .where(eq(schema.CustomField.id, field.id))

      upgradedCount++
    }
  }

  if (upgradedCount > 0) {
    logger.info('Upgraded legacy inverse meeting fields', {
      organizationId,
      upgradedCount,
    })
  }
}

/**
 * Detects and upgrades a pre-existing Meeting entity so the migration can treat
 * it as the canonical system entity instead of creating a duplicate.
 */
async function upgradeExistingMeetingEntity(db: Database, organizationId: string): Promise<void> {
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
          eq(schema.EntityDefinition.apiSlug, 'meetings'),
          sql`lower(${schema.EntityDefinition.singular}) = 'meeting'`
        )
      )
    )
    .limit(1)

  if (!existing) return

  logger.info('Found pre-existing meeting entity, upgrading to system entity', {
    organizationId,
    entityDefinitionId: existing.id,
    apiSlug: existing.apiSlug,
    singular: existing.singular,
  })

  const now = new Date()
  await db
    .update(schema.EntityDefinition)
    .set({
      entityType: 'meeting',
      apiSlug: 'meetings',
      singular: 'Meeting',
      plural: 'Meetings',
      icon: 'calendar',
      color: 'blue',
      updatedAt: now,
    })
    .where(eq(schema.EntityDefinition.id, existing.id))

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

  /**
   * Tracks the legacy relationship field IDs so we can upgrade inverse fields on
   * Company and Contact without relying on brittle label matching.
   */
  const relationshipFieldIds: { company?: string; contact?: string } = {}

  for (const field of existingFields) {
    const lowerName = field.name.toLowerCase()
    if (field.type === 'RELATIONSHIP' && lowerName === 'company') {
      relationshipFieldIds.company = field.id
    }
    if (field.type === 'RELATIONSHIP' && lowerName === 'contact') {
      relationshipFieldIds.contact = field.id
    }
  }

  let fieldsUpgraded = 0

  for (const field of existingFields) {
    let newSystemAttribute: string | undefined

    if (field.systemAttribute && TEMPLATE_FIELD_TO_SYSTEM_ATTR[field.systemAttribute]) {
      newSystemAttribute = TEMPLATE_FIELD_TO_SYSTEM_ATTR[field.systemAttribute]
    }

    if (!newSystemAttribute && field.name && field.type) {
      const key = `${field.name.toLowerCase()}::${field.type}`
      const match = LABEL_TYPE_TO_SYSTEM_ATTR.get(key)
      if (match) {
        newSystemAttribute = match.systemAttribute
      }
    }

    if (!newSystemAttribute) continue

    await db
      .update(schema.CustomField)
      .set({
        systemAttribute: newSystemAttribute as SystemAttribute,
        modelType: 'meeting',
        isCustom: false,
        updatedAt: now,
      })
      .where(eq(schema.CustomField.id, field.id))

    fieldsUpgraded++
  }

  await upgradeExistingMeetingInverseFields(db, organizationId, existing.id, relationshipFieldIds)

  logger.info('Upgraded pre-existing meeting entity', {
    organizationId,
    entityDefinitionId: existing.id,
    fieldsUpgraded,
    totalFields: existingFields.length,
  })
}

/**
 * Migration 005: Add Meeting as a system entity with Company and Contact relationships.
 */
export const migration005Meeting: EntityMigration = {
  id: '005-meeting',
  description: 'Add meeting as a system entity with company and contact relationships',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    await upgradeExistingMeetingEntity(db, organizationId)

    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entitiesToEnsure = SYSTEM_ENTITIES.filter((entity) => entity.entityType === 'meeting')
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      entitiesToEnsure,
      existing,
      state
    )

    const companyDef = existing.entityDefs.get('company')
    if (companyDef) entityDefIds.set('company', companyDef.id)

    const contactDef = existing.entityDefs.get('contact')
    if (contactDef) entityDefIds.set('contact', contactDef.id)

    const allFieldMaps = new Map<
      string,
      { id: string; systemAttribute: string; options: any; _fieldDef: any }
    >()

    const meetingDefId = entityDefIds.get('meeting')
    if (meetingDefId) {
      const meetingFields = await ensureCustomFields(
        db,
        organizationId,
        'meeting',
        meetingDefId,
        MEETING_FIELDS,
        existing,
        state
      )
      for (const [key, value] of meetingFields) {
        allFieldMaps.set(key, value)
      }
    }

    const companyDefId = entityDefIds.get('company')
    if (companyDefId) {
      const companyFields = await ensureCustomFields(
        db,
        organizationId,
        'company',
        companyDefId,
        { meetings: COMPANY_FIELDS.meetings! },
        existing,
        state
      )
      for (const [key, value] of companyFields) {
        allFieldMaps.set(key, value)
      }
    }

    const contactDefId = entityDefIds.get('contact')
    if (contactDefId) {
      const contactFields = await ensureCustomFields(
        db,
        organizationId,
        'contact',
        contactDefId,
        { meetings: CONTACT_FIELDS.meetings! },
        existing,
        state
      )
      for (const [key, value] of contactFields) {
        allFieldMaps.set(key, value)
      }
    }

    await linkNewRelationships(db, allFieldMaps, entityDefIds, state)
    await linkDisplayFields(db, ['meeting'], entityDefIds, allFieldMaps)

    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    await ensureFieldViews(
      db,
      organizationId,
      systemUserId,
      [
        {
          entityType: 'meeting',
          contextType: 'panel',
          name: 'Default Panel View',
          excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
        },
        {
          entityType: 'meeting',
          contextType: 'table',
          name: 'Default Table View',
          excludeFields: [
            'id',
            'created_at',
            'updated_at',
            'created_by_id',
            'meeting_agenda',
            'meeting_notes',
            'meeting_action_items',
          ],
        },
        {
          entityType: 'meeting',
          contextType: 'dialog_create',
          name: 'Default Create Dialog',
          includeFields: [
            'meeting_title',
            'meeting_date_time',
            'meeting_type',
            'meeting_company',
            'meeting_contact',
            'meeting_url',
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

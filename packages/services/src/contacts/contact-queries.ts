// packages/services/src/contacts/contact-queries.ts

import { database, schema } from '@auxx/database'
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { ContactContext, GetAllContactsInput, SearchContactsInput } from './types'

/**
 * Search contacts (EntityInstance where entityType = 'contact') with lightweight results.
 * Uses EntityInstance.displayName and searchText for matching.
 */
export async function searchContacts(input: SearchContactsInput) {
  const { organizationId, limit, cursor, search } = input
  const take = limit + 1

  // First resolve the contact EntityDefinition ID
  const entityDefResult = await getContactEntityDefinitionId(organizationId)
  if (entityDefResult.isErr()) return entityDefResult
  const contactDefId = entityDefResult.value

  const conditions: SQL[] = [
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, contactDefId),
    isNull(schema.EntityInstance.archivedAt),
  ]

  if (search) {
    const term = search.trim()
    conditions.push(
      or(
        ilike(schema.EntityInstance.displayName, `%${term}%`),
        ilike(schema.EntityInstance.searchText, `%${term}%`)
      )!
    )
  }

  if (cursor) {
    const [timestamp, id] = cursor.split('|')
    if (timestamp && id) {
      conditions.push(
        or(
          sql`${schema.EntityInstance.updatedAt} < ${timestamp}`,
          and(
            sql`${schema.EntityInstance.updatedAt} = ${timestamp}`,
            sql`${schema.EntityInstance.id} < ${id}`
          )
        )!
      )
    }
  }

  const result = await fromDatabase(
    database
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
        updatedAt: schema.EntityInstance.updatedAt,
      })
      .from(schema.EntityInstance)
      .where(and(...conditions))
      .orderBy(desc(schema.EntityInstance.updatedAt))
      .limit(take),
    'search-contacts'
  )

  if (result.isErr()) return result

  const items = result.value
  let nextCursor: string | undefined

  if (items.length > limit) {
    const next = items.pop()
    nextCursor = next ? `${next.updatedAt.toISOString()}|${next.id}` : undefined
  }

  return ok({ items, nextCursor })
}

/**
 * Valid sortable fields for contacts (mapped to EntityInstance columns)
 */
const SORTABLE_FIELDS = ['displayName', 'createdAt', 'updatedAt'] as const
type SortableField = (typeof SORTABLE_FIELDS)[number]

/**
 * Get all contacts (EntityInstance where entityType = 'contact') with pagination
 */
export async function getAllContacts(input: GetAllContactsInput) {
  const { organizationId, limit, cursor, search, sortField, sortDirection = 'desc' } = input

  // Validate and normalize sort field
  const validSortField: SortableField = SORTABLE_FIELDS.includes(sortField as SortableField)
    ? (sortField as SortableField)
    : 'updatedAt'

  // Resolve contact EntityDefinition ID
  const entityDefResult = await getContactEntityDefinitionId(organizationId)
  if (entityDefResult.isErr()) return entityDefResult
  const contactDefId = entityDefResult.value

  const result = await fromDatabase(
    database.query.EntityInstance.findMany({
      where: (instances, { eq, and, isNull, ilike, or, sql }) => {
        const conditions = [
          eq(instances.organizationId, organizationId),
          eq(instances.entityDefinitionId, contactDefId),
          isNull(instances.archivedAt),
        ]

        if (search) {
          conditions.push(
            or(
              ilike(instances.displayName, `%${search}%`),
              ilike(instances.searchText, `%${search}%`)
            )!
          )
        }

        if (cursor) {
          const [timestamp, id] = cursor.split('|')
          if (timestamp && id) {
            conditions.push(
              or(
                sql`${instances.updatedAt} < ${timestamp}`,
                and(sql`${instances.updatedAt} = ${timestamp}`, sql`${instances.id} < ${id}`)
              )!
            )
          }
        }

        return and(...conditions)
      },
      orderBy: (instances, { desc, asc }) => {
        const orderFn = sortDirection === 'asc' ? asc : desc
        return [orderFn(instances[validSortField])]
      },
      limit: limit + 1,
    }),
    'get-all-contacts'
  )

  if (result.isErr()) return result

  const contacts = result.value
  let nextCursor: string | undefined

  if (contacts.length > limit) {
    const next = contacts.pop()
    nextCursor = next ? `${next.updatedAt.toISOString()}|${next.id}` : undefined
  }

  return ok({ items: contacts, nextCursor })
}

/**
 * Get contact (EntityInstance) by ID
 */
export async function getContactById(input: { contactId: string } & ContactContext) {
  const { contactId, organizationId } = input

  const result = await fromDatabase(
    database.query.EntityInstance.findFirst({
      where: (instances, { eq, and }) =>
        and(eq(instances.id, contactId), eq(instances.organizationId, organizationId)),
    }),
    'get-contact-by-id'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: `Contact ${contactId} not found`,
      contactId,
    })
  }

  return ok(result.value)
}

/**
 * Get contacts (EntityInstance) by IDs
 */
export async function getContactsByIds(input: { contactIds: string[] } & ContactContext) {
  const { contactIds, organizationId } = input

  if (contactIds.length === 0) return ok([])

  const result = await fromDatabase(
    database.query.EntityInstance.findMany({
      where: (instances, { inArray, eq, and }) =>
        and(inArray(instances.id, contactIds), eq(instances.organizationId, organizationId)),
    }),
    'get-contacts-by-ids'
  )

  return result
}

/**
 * Get custom fields for organization contacts
 */
export async function getCustomFieldsForContacts(organizationId: string) {
  // First resolve the contact EntityDefinition ID
  const entityDefResult = await getContactEntityDefinitionId(organizationId)
  if (entityDefResult.isErr()) return entityDefResult
  const contactDefId = entityDefResult.value

  return fromDatabase(
    database
      .select()
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, contactDefId),
          eq(schema.CustomField.active, true)
        )
      )
      .orderBy(asc(schema.CustomField.sortOrder)),
    'get-custom-fields'
  )
}

/**
 * Get custom field values for contacts using FieldValue table
 */
export async function getCustomFieldValuesForContacts(contactIds: string[], fieldIds: string[]) {
  if (contactIds.length === 0 || fieldIds.length === 0) return ok([])

  return fromDatabase(
    database
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, contactIds),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      ),
    'get-custom-field-values'
  )
}

/**
 * Find existing contact (EntityInstance) by email via FieldValue lookup.
 * Searches for an EntityInstance with a FieldValue matching the email
 * on the primary_email system attribute field.
 */
export async function findContactByEmail(input: { email: string } & ContactContext) {
  const { email, organizationId } = input

  // Resolve the contact EntityDefinition
  const entityDefResult = await getContactEntityDefinitionId(organizationId)
  if (entityDefResult.isErr()) return entityDefResult
  const contactDefId = entityDefResult.value

  // Find the primary_email field for this entity definition
  const emailFieldResult = await fromDatabase(
    database
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.entityDefinitionId, contactDefId),
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'primary_email')
        )
      )
      .limit(1),
    'find-email-field'
  )

  if (emailFieldResult.isErr()) return emailFieldResult
  if (emailFieldResult.value.length === 0) return ok(null)

  const emailFieldId = emailFieldResult.value[0]!.id

  // Look up FieldValue for matching email
  const fieldValueResult = await fromDatabase(
    database
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.fieldId, emailFieldId),
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.valueText, email)
        )
      )
      .limit(1),
    'find-contact-by-email-field-value'
  )

  if (fieldValueResult.isErr()) return fieldValueResult
  if (fieldValueResult.value.length === 0) return ok(null)

  const entityId = fieldValueResult.value[0]!.entityId

  // Fetch the EntityInstance
  const instanceResult = await fromDatabase(
    database
      .select()
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, entityId),
          eq(schema.EntityInstance.organizationId, organizationId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .limit(1),
    'find-contact-by-email'
  )

  if (instanceResult.isErr()) return instanceResult
  return ok(instanceResult.value[0] ?? null)
}

/**
 * Helper: resolve the EntityDefinition ID for contacts in this organization.
 * Contacts have entityType = 'contact' on the EntityDefinition.
 */
async function getContactEntityDefinitionId(organizationId: string) {
  const result = await fromDatabase(
    database
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'contact')
        )
      )
      .limit(1),
    'get-contact-entity-definition'
  )

  if (result.isErr()) return result
  if (result.value.length === 0) {
    return err({
      code: 'CONTACT_NOT_FOUND' as const,
      message: 'Contact entity definition not found for organization',
      contactId: undefined as unknown as string,
    })
  }

  return ok(result.value[0]!.id)
}

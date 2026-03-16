// packages/lib/src/contacts/contact-service.ts

import { database, schema } from '@auxx/database'
import type { CustomerSourceType, CustomerStatus } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import * as contactDb from '@auxx/services/contacts'
import { and, eq } from 'drizzle-orm'
import { publisher } from '../events'
import type { ContactCreatedEvent, ContactDeletedEvent, ContactUpdatedEvent } from '../events/types'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('contact-service')

/**
 * Contact list item type
 */
export type ContactListItem = any

/**
 * Basic contact item for search results
 */
export type BasicContactItem = any

/**
 * Detailed contact item for single contact view
 */
export type ContactWithDetails = any

/**
 * Contact with custom field values
 */
export type ContactWithCustomFields = ContactListItem & {
  fieldValues?: Array<{
    fieldId: string
    value: any
  }>
}

/**
 * Result type for paginated contact lists
 */
export interface PaginatedContactsResult {
  items: ContactListItem[]
  nextCursor: string | undefined
  totalCount?: number
}

/**
 * Result type for basic search
 */
export interface PaginatedBasicContactsResult {
  items: BasicContactItem[]
  nextCursor: string | undefined
}

/**
 * Result type for paginated contact lists with custom fields
 */
export interface PaginatedContactsWithFieldsResult {
  items: ContactWithCustomFields[]
  nextCursor: string | undefined
  customFields?: Array<{
    id: string
    name: string
    type: string
    options?: any
  }>
}

/**
 * Input type for getAll method
 */
export type GetAllContactsInput = {
  limit: number
  cursor?: string
  search?: string
  status?: CustomerStatus
  groupId?: string
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

/**
 * Input type for create method
 */
export type CreateContactInput = {
  name?: string
  firstName?: string
  lastName?: string
  email: string
  phone?: string
  notes?: string
  tags?: string[]
  sourceType: CustomerSourceType
  sourceId?: string
  sourceData?: any
}

/**
 * Input type for update method
 */
export type UpdateContactInput = {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  notes?: string
  tags?: string[]
  status?: CustomerStatus
}

/**
 * SearchContactsInput re-exported for callers
 */
export type SearchContactsInput = {
  limit: number
  cursor?: string
  search?: string
}

/**
 * ContactService orchestrates contact operations, handling business logic and events.
 * Contacts are stored as EntityInstance + FieldValue (managed via UnifiedCrudHandler).
 */
export class ContactService {
  private readonly organizationId: string
  private readonly userId?: string

  constructor(organizationId: string, userId?: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Create a UnifiedCrudHandler for this service context.
   */
  private createHandler(): UnifiedCrudHandler {
    return new UnifiedCrudHandler(this.organizationId, this.userId || 'system')
  }

  /**
   * Get all contacts with pagination.
   */
  async getAllContacts(input: GetAllContactsInput): Promise<PaginatedContactsResult> {
    const result = await contactDb.getAllContacts({
      organizationId: this.organizationId,
      limit: input.limit,
      cursor: input.cursor,
      search: input.search,
      sortField: input.sortField,
      sortDirection: input.sortDirection,
    })

    if (result.isErr()) {
      logger.error('Failed to get all contacts', {
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching contacts: ${result.error.message}`)
    }

    const { items: contacts, nextCursor } = result.value
    const contactsWithCounts = contacts.map((contact) => ({
      ...contact,
      _count: { tickets: 0 },
    }))

    return { items: contactsWithCounts as ContactListItem[], nextCursor }
  }

  /**
   * Get all contacts with custom field values
   */
  async getAllContactsWithCustomFields(
    input: GetAllContactsInput
  ): Promise<PaginatedContactsWithFieldsResult> {
    const result = await this.getAllContacts(input)

    // Get custom fields for contacts from org cache
    const { getCachedEntityDefId, getCachedCustomFields } = await import('../cache')
    const contactDefId = await getCachedEntityDefId(this.organizationId, 'contact')
    const customFields = contactDefId
      ? await getCachedCustomFields(this.organizationId, contactDefId)
      : []
    if (customFields.length === 0) {
      return {
        items: result.items as ContactWithCustomFields[],
        nextCursor: result.nextCursor,
        customFields: [],
      }
    }

    const contactIds = result.items.map((contact) => contact.id)
    const fieldIds = customFields.map((f) => f.id)

    const valuesResult = await contactDb.getCustomFieldValuesForContacts(contactIds, fieldIds)
    if (valuesResult.isErr()) {
      throw new Error(`Database error fetching custom field values: ${valuesResult.error.message}`)
    }

    const valuesByContactId = valuesResult.value.reduce(
      (acc, value) => {
        if (!acc[value.entityId]) {
          acc[value.entityId] = []
        }
        acc[value.entityId].push({
          fieldId: value.fieldId,
          value: (value as any).value ?? (value as any).valueText,
        })
        return acc
      },
      {} as Record<string, Array<{ fieldId: string; value: any }>>
    )

    const contactsWithFields: ContactWithCustomFields[] = result.items.map((contact) => ({
      ...contact,
      fieldValues: valuesByContactId[contact.id] || [],
    }))

    return {
      items: contactsWithFields,
      nextCursor: result.nextCursor,
      customFields: customFields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options,
      })),
    }
  }

  /**
   * Get a single contact by ID.
   */
  async getContactById(id: string): Promise<ContactWithDetails | null> {
    const result = await contactDb.getContactById({
      contactId: id,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      if (result.error.code === 'CONTACT_NOT_FOUND') {
        return null
      }
      logger.error('Failed to get contact by ID', {
        contactId: id,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching contact ${id}: ${result.error.message}`)
    }

    return { ...result.value, tickets: [] } as ContactWithDetails
  }

  /**
   * Get multiple contacts by their IDs.
   */
  async getContactsByIds(ids: string[]): Promise<ContactListItem[]> {
    if (ids.length === 0) return []

    const result = await contactDb.getContactsByIds({
      contactIds: ids,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to get contacts by IDs', {
        contactIds: ids,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching contacts: ${result.error.message}`)
    }

    return result.value.map((contact) => ({
      ...contact,
      _count: { tickets: 0 },
    })) as ContactListItem[]
  }

  /**
   * Create a new contact via UnifiedCrudHandler.
   */
  async createContact(input: CreateContactInput): Promise<ContactListItem> {
    const { firstName, lastName, email, phone, notes } = input

    // Check if contact already exists by email
    const existingResult = await contactDb.findContactByEmail({
      email,
      organizationId: this.organizationId,
    })

    if (existingResult.isErr()) {
      throw new Error(`Database error checking existing contact: ${existingResult.error.message}`)
    }

    if (existingResult.value) {
      return (await this.getContactsByIds([existingResult.value.id]))[0]
    }

    // Create via UnifiedCrudHandler
    const handler = this.createHandler()
    const result = await handler.create('contact', {
      primary_email: email,
      ...(firstName && { first_name: firstName }),
      ...(lastName && { last_name: lastName }),
      ...(phone && { phone }),
      ...(notes && { notes }),
    })

    const contact = result.instance
    const fullContact = (await this.getContactsByIds([contact.id]))[0]

    await publisher.publishLater({
      type: 'contact:created',
      data: {
        contactId: contact.id,
        organizationId: this.organizationId,
        userId: this.userId,
        firstName,
        lastName,
        email,
        phone,
        sourceType: input.sourceType,
      },
    } as ContactCreatedEvent)

    return fullContact
  }

  /**
   * Update an existing contact via UnifiedCrudHandler.
   */
  async updateContact(input: UpdateContactInput): Promise<ContactListItem> {
    const { id, ...data } = input

    // Verify contact exists
    const existingResult = await contactDb.getContactById({
      contactId: id,
      organizationId: this.organizationId,
    })

    if (existingResult.isErr()) {
      if (existingResult.error.code === 'CONTACT_NOT_FOUND') {
        throw new Error(`Contact ${id} not found.`)
      }
      throw new Error(`Database error fetching contact: ${existingResult.error.message}`)
    }

    // Build values map for UnifiedCrudHandler
    const values: Record<string, unknown> = {}
    if (data.firstName !== undefined) values.first_name = data.firstName
    if (data.lastName !== undefined) values.last_name = data.lastName
    if (data.email !== undefined) values.primary_email = data.email
    if (data.phone !== undefined) values.phone = data.phone
    if (data.notes !== undefined) values.notes = data.notes
    if (data.status !== undefined) values.contact_status = data.status

    if (Object.keys(values).length > 0) {
      const handler = this.createHandler()
      const entityDef = await handler.resolveEntityDefinition('contact')
      const { toRecordId } = await import('@auxx/types/resource')
      const recordId = toRecordId(entityDef.id, id)
      await handler.update(recordId, values)
    }

    const fullContact = (await this.getContactsByIds([id]))[0]

    if (this.userId) {
      await publisher.publishLater({
        type: 'contact:updated',
        data: {
          contactId: id,
          organizationId: this.organizationId,
          userId: this.userId,
          firstName: fullContact.displayName,
          email: data.email,
          changes: [],
        },
      } as ContactUpdatedEvent)
    }

    return fullContact
  }

  /**
   * Delete a contact via UnifiedCrudHandler.
   */
  async deleteContact(id: string): Promise<{ count: number }> {
    const handler = this.createHandler()
    const entityDef = await handler.resolveEntityDefinition('contact')
    const { toRecordId } = await import('@auxx/types/resource')
    const recordId = toRecordId(entityDef.id, id)

    try {
      await handler.delete(recordId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found') || message.includes('NOT_FOUND')) {
        throw new Error(`Contact ${id} not found.`)
      }
      throw error
    }

    const effectiveUserId =
      this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

    await publisher.publishLater({
      type: 'contact:deleted',
      data: {
        contactId: id,
        organizationId: this.organizationId,
        userId: effectiveUserId,
      },
    } as ContactDeletedEvent)

    logger.info('Deleted contact', { contactId: id, organizationId: this.organizationId })
    return { count: 1 }
  }

  /**
   * Mark a contact as spam via UnifiedCrudHandler.
   */
  async markContactAsSpam(id: string): Promise<ContactListItem> {
    const handler = this.createHandler()
    const entityDef = await handler.resolveEntityDefinition('contact')
    const { toRecordId } = await import('@auxx/types/resource')
    const recordId = toRecordId(entityDef.id, id)

    try {
      await handler.update(recordId, { contact_status: 'SPAM' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found') || message.includes('NOT_FOUND')) {
        throw new Error(`Contact ${id} not found.`)
      }
      logger.error('Failed to mark contact as spam', {
        contactId: id,
        organizationId: this.organizationId,
        error: message,
      })
      throw new Error(`Failed to mark contact as spam: ${message}`)
    }

    return (await this.getContactsByIds([id]))[0]
  }

  /**
   * Bulk mark contacts as spam via UnifiedCrudHandler.
   */
  async bulkMarkAsSpam(ids: string[]): Promise<{ count: number }> {
    if (ids.length === 0) throw new Error('No contacts provided.')

    const handler = this.createHandler()
    const entityDef = await handler.resolveEntityDefinition('contact')
    const { toRecordId } = await import('@auxx/types/resource')
    const recordIds = ids.map((id) => toRecordId(entityDef.id, id))

    // Resolve the contact_status field ID
    const statusField = await this.resolveFieldId('contact_status')
    const result = await handler.bulkSetFieldValue(recordIds, statusField, 'SPAM')

    if (result.count === 0) {
      throw new Error('No valid contacts found to mark as spam.')
    }

    logger.info('Marked multiple contacts as spam', {
      count: result.count,
      contactIds: ids,
      organizationId: this.organizationId,
    })

    return { count: result.count }
  }

  /**
   * Bulk delete contacts via UnifiedCrudHandler.
   */
  async bulkDeleteContacts(
    ids: string[]
  ): Promise<{ count: number; errors: Array<{ recordId: string; message: string }> }> {
    if (ids.length === 0) throw new Error('No contacts provided.')

    const handler = this.createHandler()
    const entityDef = await handler.resolveEntityDefinition('contact')
    const { toRecordId, parseRecordId } = await import('@auxx/types/resource')
    const recordIds = ids.map((id) => toRecordId(entityDef.id, id))

    const result = await handler.bulkDelete(recordIds)

    if (result.count === 0 && result.errors.length > 0) {
      throw new Error('No valid contacts found to delete.')
    }

    const effectiveUserId =
      this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

    const failedIds = new Set(result.errors.map((e) => parseRecordId(e.recordId).entityInstanceId))

    for (const id of ids) {
      if (failedIds.has(id)) continue
      await publisher.publishLater({
        type: 'contact:deleted',
        data: {
          contactId: id,
          organizationId: this.organizationId,
          userId: effectiveUserId,
        },
      } as ContactDeletedEvent)
    }

    logger.info('Bulk deleted contacts', {
      count: result.count,
      errors: result.errors.length,
      contactIds: ids,
      organizationId: this.organizationId,
    })

    return { count: result.count, errors: result.errors }
  }

  /**
   * Resolve a systemAttribute to its CustomField ID for bulkSetFieldValue.
   */
  private async resolveFieldId(systemAttribute: string): Promise<string> {
    const field = await database
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
      )
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, this.organizationId),
          eq(schema.EntityDefinition.entityType, 'contact'),
          eq(schema.CustomField.systemAttribute, systemAttribute)
        )
      )
      .limit(1)

    if (!field[0]) throw new Error(`Field ${systemAttribute} not found for contact entity`)
    return field[0].id
  }
}

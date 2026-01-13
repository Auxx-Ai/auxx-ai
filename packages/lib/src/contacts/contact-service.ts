// packages/lib/src/contacts/contact-service.ts

import { database, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { v4 as uuidv4 } from 'uuid'
import type { CustomerStatus, CustomerSourceType } from '@auxx/database/types'
import { publisher } from '../events'
import { SystemUserService } from '../users/system-user-service'
import * as contactDb from '@auxx/services/contacts'
import type {
  ContactCreatedEvent,
  ContactUpdatedEvent,
  ContactDeletedEvent,
  ContactMergedEvent,
  ContactGroupAddedEvent,
  ContactGroupRemovedEvent,
} from '../events/types'

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
  customFieldValues?: Array<{
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
 * Input type for search method
 */
export type SearchContactsInput = {
  limit: number
  cursor?: string
  search?: string
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
 * ContactService orchestrates contact operations, handling business logic and events
 */
export class ContactService {
  private readonly organizationId: string
  private readonly userId?: string

  constructor(organizationId: string, userId?: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Search contacts with a simple query and pagination.
   */
  async searchContacts(input: SearchContactsInput): Promise<PaginatedBasicContactsResult> {
    const result = await contactDb.searchContacts({
      organizationId: this.organizationId,
      limit: input.limit,
      cursor: input.cursor,
      search: input.search,
    })

    if (result.isErr()) {
      logger.error('Failed to search contacts', {
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error searching contacts: ${result.error.message}`)
    }

    return result.value
  }

  /**
   * Get all contacts with detailed filtering options and pagination.
   */
  async getAllContacts(input: GetAllContactsInput): Promise<PaginatedContactsResult> {
    const result = await contactDb.getAllContacts({
      organizationId: this.organizationId,
      limit: input.limit,
      cursor: input.cursor,
      search: input.search,
      status: input.status,
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
    const contactIds = contacts.map((c) => c.id)

    const ticketCountsResult = await contactDb.getTicketCountsForContacts(contactIds)
    if (ticketCountsResult.isErr()) {
      throw new Error(`Database error fetching ticket counts: ${ticketCountsResult.error.message}`)
    }

    const ticketCountMap = ticketCountsResult.value
    const contactsWithCounts = contacts.map((contact) => ({
      ...contact,
      _count: { tickets: ticketCountMap.get(contact.id) || 0 },
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

    const customFieldsResult = await contactDb.getCustomFieldsForContacts(this.organizationId)
    if (customFieldsResult.isErr()) {
      throw new Error(`Database error fetching custom fields: ${customFieldsResult.error.message}`)
    }

    const customFields = customFieldsResult.value
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
        acc[value.entityId].push({ fieldId: value.fieldId, value: value.value })
        return acc
      },
      {} as Record<string, Array<{ fieldId: string; value: any }>>
    )

    const contactsWithFields: ContactWithCustomFields[] = result.items.map((contact) => ({
      ...contact,
      customFieldValues: valuesByContactId[contact.id] || [],
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
   * Get a single contact by ID with detailed information.
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

    const contact = result.value

    const ticketsResult = await contactDb.getRecentTickets(id, 5)
    if (ticketsResult.isErr()) {
      throw new Error(`Database error fetching tickets: ${ticketsResult.error.message}`)
    }

    return { ...contact, tickets: ticketsResult.value } as ContactWithDetails
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

    const contacts = result.value
    const contactIds = contacts.map((c) => c.id)

    const ticketCountsResult = await contactDb.getTicketCountsForContacts(contactIds)
    if (ticketCountsResult.isErr()) {
      throw new Error(`Database error fetching ticket counts: ${ticketCountsResult.error.message}`)
    }

    const ticketCountMap = ticketCountsResult.value
    return contacts.map((contact) => ({
      ...contact,
      _count: { tickets: ticketCountMap.get(contact.id) || 0 },
    })) as ContactListItem[]
  }

  /**
   * Create a new contact.
   */
  async createContact(input: CreateContactInput): Promise<ContactListItem> {
    const { name, firstName, lastName, email, phone, notes, tags, sourceType, sourceData } = input
    const sourceId =
      sourceType === 'MANUAL' ? `manual-${uuidv4()}` : input.sourceId || `unknown-${uuidv4()}`

    const existingResult = await contactDb.findContactByEmail({
      email,
      organizationId: this.organizationId,
    })

    if (existingResult.isErr()) {
      throw new Error(`Database error checking existing contact: ${existingResult.error.message}`)
    }

    if (existingResult.value) {
      await contactDb.insertCustomerSource({
        organizationId: this.organizationId,
        contactId: existingResult.value.id,
        source: sourceType,
        sourceId,
        email,
        sourceData: sourceData || {},
      })

      return (await this.getContactsByIds([existingResult.value.id]))[0]
    }

    const contactResult = await contactDb.insertContact({
      organizationId: this.organizationId,
      email,
      emails: [email],
      name,
      firstName,
      lastName,
      phone,
      notes,
      tags,
    })

    if (contactResult.isErr()) {
      logger.error('Failed to create contact', {
        email,
        organizationId: this.organizationId,
        error: contactResult.error.message,
      })
      throw new Error(`Database error creating contact: ${contactResult.error.message}`)
    }

    const contact = contactResult.value!

    await contactDb.insertCustomerSource({
      organizationId: this.organizationId,
      contactId: contact.id,
      source: sourceType,
      sourceId,
      email,
      sourceData: sourceData || {},
    })

    const fullContact = (await this.getContactsByIds([contact.id]))[0]

    await publisher.publishLater({
      type: 'contact:created',
      data: {
        contactId: contact.id,
        organizationId: this.organizationId,
        userId: this.userId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        sourceType,
      },
    } as ContactCreatedEvent)

    return fullContact
  }

  /**
   * Update an existing contact.
   */
  async updateContact(input: UpdateContactInput): Promise<ContactListItem> {
    const { id, ...data } = input

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

    const oldContact = existingResult.value

    const changes: Array<{ field: string; oldValue: any; newValue: any }> = []
    if (data.firstName && data.firstName !== oldContact.firstName) {
      changes.push({ field: 'firstName', oldValue: oldContact.firstName, newValue: data.firstName })
    }
    if (data.lastName && data.lastName !== oldContact.lastName) {
      changes.push({ field: 'lastName', oldValue: oldContact.lastName, newValue: data.lastName })
    }
    if (data.email && data.email !== oldContact.email) {
      changes.push({ field: 'email', oldValue: oldContact.email, newValue: data.email })
    }
    if (data.phone && data.phone !== oldContact.phone) {
      changes.push({ field: 'phone', oldValue: oldContact.phone, newValue: data.phone })
    }

    const updateResult = await contactDb.updateContact({
      id,
      organizationId: this.organizationId,
      ...data,
    })

    if (updateResult.isErr()) {
      logger.error('Failed to update contact', {
        contactId: id,
        organizationId: this.organizationId,
        error: updateResult.error.message,
      })
      throw new Error(`Database error updating contact ${id}: ${updateResult.error.message}`)
    }

    const fullContact = (await this.getContactsByIds([id]))[0]

    if (changes.length > 0 && this.userId) {
      await publisher.publishLater({
        type: 'contact:updated',
        data: {
          contactId: id,
          organizationId: this.organizationId,
          userId: this.userId,
          firstName: fullContact.firstName,
          lastName: fullContact.lastName,
          email: fullContact.email,
          changes,
        },
      } as ContactUpdatedEvent)
    }

    return fullContact
  }

  /**
   * Delete a contact by ID.
   */
  async deleteContact(id: string): Promise<{ count: number }> {
    return await database.transaction(async (tx: Transaction) => {
      const existingResult = await contactDb.getContactForDeletion({
        contactId: id,
        organizationId: this.organizationId,
      })

      if (existingResult.isErr()) {
        if (existingResult.error.code === 'CONTACT_NOT_FOUND') {
          throw new Error(`Contact ${id} not found.`)
        }
        throw new Error(`Database error: ${existingResult.error.message}`)
      }

      const deleteResult = await contactDb.deleteContactWithRelations(tx, id, this.organizationId)

      const effectiveUserId =
        this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

      if (deleteResult.length > 0) {
        await publisher.publishLater({
          type: 'contact:deleted',
          data: {
            contactId: id,
            organizationId: this.organizationId,
            userId: effectiveUserId,
          },
        } as ContactDeletedEvent)
      }

      logger.info('Deleted contact', { contactId: id, organizationId: this.organizationId })
      return { count: deleteResult.length }
    })
  }

  /**
   * Mark a contact as spam.
   */
  async markContactAsSpam(id: string): Promise<ContactListItem> {
    const result = await contactDb.updateContactStatus({
      contactId: id,
      organizationId: this.organizationId,
      status: 'SPAM',
    })

    if (result.isErr()) {
      if (result.error.code === 'CONTACT_NOT_FOUND') {
        throw new Error(`Contact ${id} not found.`)
      }
      logger.error('Failed to mark contact as spam', {
        contactId: id,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error marking contact as spam: ${result.error.message}`)
    }

    return (await this.getContactsByIds([id]))[0]
  }

  /**
   * Bulk mark contacts as spam.
   */
  async bulkMarkAsSpam(ids: string[]): Promise<{ count: number }> {
    const result = await contactDb.bulkUpdateToSpam({
      contactIds: ids,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to mark multiple contacts as spam', {
        contactIds: ids,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error marking contacts as spam: ${result.error.message}`)
    }

    if (result.value.count === 0) {
      throw new Error('No valid contacts found to mark as spam.')
    }

    logger.info('Marked multiple contacts as spam', {
      count: result.value.count,
      contactIds: ids,
      organizationId: this.organizationId,
    })

    return { count: result.value.count }
  }

  /**
   * Bulk delete contacts.
   */
  async bulkDeleteContacts(ids: string[]): Promise<{ count: number }> {
    return await database.transaction(async (tx: Transaction) => {
      const deleted = await contactDb.bulkDeleteContacts(tx, ids, this.organizationId)

      if (deleted.length === 0) {
        throw new Error('No valid contacts found to delete.')
      }

      const effectiveUserId =
        this.userId || (await SystemUserService.getSystemUserForActions(this.organizationId))

      for (const deletedContact of deleted) {
        await publisher.publishLater({
          type: 'contact:deleted',
          data: {
            contactId: deletedContact.id,
            organizationId: this.organizationId,
            userId: effectiveUserId,
          },
        } as ContactDeletedEvent)
      }

      logger.info('Bulk deleted contacts', {
        count: deleted.length,
        contactIds: ids,
        organizationId: this.organizationId,
      })

      return { count: deleted.length }
    })
  }

  /**
   * Get all customer groups with optional search filter.
   */
  async getCustomerGroups(search?: string) {
    const result = await contactDb.getCustomerGroups({
      organizationId: this.organizationId,
      search,
    })

    if (result.isErr()) {
      logger.error('Failed to get customer groups', {
        organizationId: this.organizationId,
        search,
        error: result.error.message,
      })
      throw new Error(`Database error fetching customer groups: ${result.error.message}`)
    }

    return result.unwrapOr([])
  }

  /**
   * Create a new customer group.
   */
  async createCustomerGroup(
    name: string,
    description?: string,
    initialMemberIds?: string[]
  ): Promise<any> {
    const existsResult = await contactDb.checkGroupNameExists({
      name,
      organizationId: this.organizationId,
    })

    if (existsResult.isErr()) {
      throw new Error(`Database error: ${existsResult.error.message}`)
    }

    if (existsResult.value) {
      throw new Error('A group with this name already exists')
    }

    const groupResult = await contactDb.insertCustomerGroup({
      name,
      description,
      organizationId: this.organizationId,
    })

    if (groupResult.isErr()) {
      logger.error('Failed to create customer group', {
        name,
        organizationId: this.organizationId,
        error: groupResult.error.message,
      })
      throw new Error(`Database error creating customer group: ${groupResult.error.message}`)
    }

    const newGroup = groupResult.value!

    if (initialMemberIds && initialMemberIds.length > 0) {
      await contactDb.addContactsToGroup({
        groupId: newGroup.id,
        contactIds: initialMemberIds,
        organizationId: this.organizationId,
      })
    }

    return newGroup
  }

  /**
   * Update an existing customer group.
   */
  async updateCustomerGroup(
    id: string,
    data: { name?: string; description?: string }
  ): Promise<any> {
    const result = await contactDb.updateCustomerGroup({
      groupId: id,
      organizationId: this.organizationId,
      name: data.name,
      description: data.description,
    })

    if (result.isErr()) {
      if (result.error.code === 'CUSTOMER_GROUP_NOT_FOUND') {
        throw new Error(`Group ${id} not found.`)
      }
      logger.error('Failed to update customer group', {
        groupId: id,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error updating customer group: ${result.error.message}`)
    }

    return result.value
  }

  /**
   * Add contacts to a customer group.
   */
  async addToCustomerGroup(groupId: string, contactIds: string[]): Promise<{ success: boolean }> {
    const groupResult = await contactDb.getCustomerGroupById({
      groupId,
      organizationId: this.organizationId,
    })

    if (groupResult.isErr()) {
      if (groupResult.error.code === 'CUSTOMER_GROUP_NOT_FOUND') {
        throw new Error(`Group ${groupId} not found.`)
      }
      throw new Error(`Database error: ${groupResult.error.message}`)
    }

    const group = groupResult.value

    const result = await contactDb.addContactsToGroup({
      groupId,
      contactIds,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to add contacts to group', {
        groupId,
        contactIds,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error adding contacts to group: ${result.error.message}`)
    }

    if (this.userId) {
      for (const contactId of contactIds) {
        await publisher.publishLater({
          type: 'contact:group:added',
          data: {
            contactId,
            organizationId: this.organizationId,
            userId: this.userId,
            groupId,
            groupName: group.name,
          },
        } as ContactGroupAddedEvent)
      }
    }

    return { success: true }
  }

  /**
   * Remove contacts from a customer group.
   */
  async removeFromCustomerGroup(
    groupId: string,
    contactIds: string[]
  ): Promise<{ success: boolean }> {
    const groupResult = await contactDb.getCustomerGroupById({
      groupId,
      organizationId: this.organizationId,
    })

    const group = groupResult.isOk() ? groupResult.value : null

    const result = await contactDb.removeContactsFromGroup({
      groupId,
      contactIds,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to remove contacts from group', {
        groupId,
        contactIds,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error removing contacts from group: ${result.error.message}`)
    }

    if (this.userId && group) {
      for (const contactId of contactIds) {
        await publisher.publishLater({
          type: 'contact:group:removed',
          data: {
            contactId,
            organizationId: this.organizationId,
            userId: this.userId,
            groupId,
            groupName: group.name,
          },
        } as ContactGroupRemovedEvent)
      }
    }

    return { success: true }
  }

  /**
   * Delete a customer group.
   */
  async deleteCustomerGroup(id: string): Promise<{ success: boolean }> {
    const result = await contactDb.deleteCustomerGroup({
      groupId: id,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to delete customer group', {
        groupId: id,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error deleting customer group: ${result.error.message}`)
    }

    if (!result.value) {
      throw new Error(`Group ${id} not found.`)
    }

    return { success: true }
  }

  /**
   * Get customer groups by contact IDs.
   */
  async getCustomerGroupsByContactIds(contactIds: string[]): Promise<any[]> {
    if (contactIds.length === 0) return []

    const result = await contactDb.getGroupsForContacts({
      contactIds,
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      logger.error('Failed to get customer groups by contact IDs', {
        contactIds,
        organizationId: this.organizationId,
        error: result.error.message,
      })
      throw new Error(`Database error fetching customer groups: ${result.error.message}`)
    }

    return result.value
  }
}

// packages/services/src/contacts/types.ts

import type { CustomerSourceType, CustomerStatus } from '@auxx/database/types'

/**
 * Base context for all contact operations
 */
export interface ContactContext {
  organizationId: string
}

/**
 * Pagination cursor for contact lists
 */
export interface ContactCursor {
  updatedAt: Date
  id: string
}

/**
 * Input for searching contacts
 */
export interface SearchContactsInput extends ContactContext {
  limit: number
  cursor?: string
  search?: string
}

/**
 * Input for getting all contacts
 */
export interface GetAllContactsInput extends ContactContext {
  limit: number
  cursor?: string
  search?: string
  status?: CustomerStatus
  groupId?: string
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

/**
 * Input for creating a contact (DB layer - no event publishing)
 */
export interface InsertContactInput extends ContactContext {
  email: string
  emails?: string[]
  name?: string
  firstName?: string
  lastName?: string
  phone?: string
  notes?: string
  tags?: string[]
}

/**
 * Input for creating a customer source
 */
export interface InsertCustomerSourceInput extends ContactContext {
  contactId: string
  source: CustomerSourceType
  sourceId: string
  email: string
  sourceData?: Record<string, unknown>
}

/**
 * Input for updating a contact
 */
export interface UpdateContactInput extends ContactContext {
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

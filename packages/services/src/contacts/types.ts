// packages/services/src/contacts/types.ts

import type { CustomerStatus } from '@auxx/database/types'

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

// packages/lib/src/contacts/contact-service.ts

import { createScopedLogger } from '@auxx/logger'
import * as contactDb from '@auxx/services/contacts'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'

const logger = createScopedLogger('contact-service')

export type ContactListItem = any
export type ContactWithDetails = any

/**
 * ContactService — thin wrapper around the generic entity CRUD path for the
 * few contact-specific endpoints that still have dedicated UI (getById,
 * markAsSpam). All other contact CRUD goes through UnifiedCrudHandler directly
 * via `api.record.*`.
 */
export class ContactService {
  private readonly organizationId: string
  private readonly userId?: string

  constructor(organizationId: string, userId?: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  private createHandler(): UnifiedCrudHandler {
    return new UnifiedCrudHandler(this.organizationId, this.userId || 'system')
  }

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

    const result = await contactDb.getContactsByIds({
      contactIds: [id],
      organizationId: this.organizationId,
    })

    if (result.isErr()) {
      throw new Error(`Database error fetching contact: ${result.error.message}`)
    }

    return result.value[0] as ContactListItem
  }
}

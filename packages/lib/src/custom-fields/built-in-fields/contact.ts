// packages/lib/src/custom-fields/built-in-fields/contact.ts

import { FieldType } from '@auxx/database/enums'
import type { BuiltInFieldRegistry } from './types'

/**
 * Built-in field handlers for Contact model
 */
export const contactBuiltInFields: BuiltInFieldRegistry = {
  // Standard fields - direct update
  email: {
    id: 'email',
    type: FieldType.EMAIL,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined)
      await service.updateContact({ id: entityId, email: value })
    },
  },

  phone: {
    id: 'phone',
    type: FieldType.PHONE_INTL,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined)
      await service.updateContact({ id: entityId, phone: value })
    },
  },

  status: {
    id: 'status',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined)
      await service.updateContact({ id: entityId, status: value })
    },
  },

  // Relationship field - customerGroups
  customerGroups: {
    id: 'customerGroups',
    type: FieldType.MULTI_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      console.log('[customerGroups handler] Called with:', { entityId, value, organizationId })

      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined)

      // 1. Get current groups
      const contact = await db.query.Contact.findFirst({
        where: (contacts, { eq }) => eq(contacts.id, entityId),
        with: {
          customerGroups: {
            with: { customerGroup: true },
          },
        },
      })

      const currentGroupIds =
        contact?.customerGroups.map((cg) => cg.customerGroup?.id).filter(Boolean) || []

      const newGroupIds = Array.isArray(value) ? value : []

      // 2. Compute diff
      const toAdd = newGroupIds.filter((id) => !currentGroupIds.includes(id))
      const toRemove = currentGroupIds.filter((id) => !newGroupIds.includes(id))

      // 3. Apply changes
      for (const groupId of toAdd) {
        console.log('[customerGroups handler] Adding to group:', groupId)
        await service.addToCustomerGroup(groupId, [entityId])
      }

      for (const groupId of toRemove) {
        console.log('[customerGroups handler] Removing from group:', groupId)
        await service.removeFromCustomerGroup(groupId, [entityId])
      }

      console.log('[customerGroups handler] Done')
    },
  },
}

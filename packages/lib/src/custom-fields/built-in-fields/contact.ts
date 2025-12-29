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
      const service = new ContactService(organizationId, undefined, db)
      await service.updateContact({ id: entityId, email: value })
    },
  },

  phone: {
    id: 'phone',
    type: FieldType.PHONE,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined, db)
      await service.updateContact({ id: entityId, phone: value })
    },
  },

  status: {
    id: 'status',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined, db)
      await service.updateContact({ id: entityId, status: value })
    },
  },

  // Compound field - name
  name: {
    id: 'name',
    type: FieldType.NAME,
    handler: async (db, entityId, value, organizationId) => {
      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined, db)
      await service.updateContact({
        id: entityId,
        firstName: value.firstName,
        lastName: value.lastName,
      })
    },
  },

  // Relationship field - customerGroups
  customerGroups: {
    id: 'customerGroups',
    type: FieldType.MULTI_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      console.log('[customerGroups handler] Called with:', { entityId, value, organizationId })

      const { ContactService } = await import('../../contacts/contact-service')
      const service = new ContactService(organizationId, undefined, db)

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

      console.log('[customerGroups handler] Current groups:', currentGroupIds)
      console.log('[customerGroups handler] New groups:', newGroupIds)

      // 2. Compute diff
      const toAdd = newGroupIds.filter((id) => !currentGroupIds.includes(id))
      const toRemove = currentGroupIds.filter((id) => !newGroupIds.includes(id))

      console.log('[customerGroups handler] To add:', toAdd)
      console.log('[customerGroups handler] To remove:', toRemove)

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

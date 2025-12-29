// packages/lib/src/custom-fields/built-in-fields/ticket.ts

import { FieldType } from '@auxx/database/enums'
import type { BuiltInFieldRegistry } from './types'
import { parse } from 'date-fns'

/**
 * Built-in field handlers for Ticket model
 * Uses TicketService to ensure proper event publishing and business logic
 */
export const ticketBuiltInFields: BuiltInFieldRegistry = {
  title: {
    id: 'title',
    type: FieldType.TEXT,
    handler: async (db, entityId, value, organizationId) => {
      const { TicketService } = await import('../../tickets/ticket-service')
      const service = new TicketService(db)
      await service.updateTicket({
        id: entityId,
        title: value,
        organizationId,
        userId: undefined, // System update via built-in field handler
      })
    },
  },

  status: {
    id: 'status',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      const { TicketService } = await import('../../tickets/ticket-service')
      const service = new TicketService(db)
      // Use dedicated status update method for proper timestamp handling
      await service.updateTicketStatus(entityId, value, organizationId, undefined)
    },
  },

  priority: {
    id: 'priority',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      const { TicketService } = await import('../../tickets/ticket-service')
      const service = new TicketService(db)
      await service.updateTicket({
        id: entityId,
        priority: value,
        organizationId,
        userId: undefined,
      })
    },
  },

  type: {
    id: 'type',
    type: FieldType.SINGLE_SELECT,
    handler: async (db, entityId, value, organizationId) => {
      const { TicketService } = await import('../../tickets/ticket-service')
      const service = new TicketService(db)
      await service.updateTicket({
        id: entityId,
        type: value,
        organizationId,
        userId: undefined,
      })
    },
  },

  dueDate: {
    id: 'dueDate',
    type: FieldType.DATE,
    handler: async (db, entityId, value, organizationId) => {
      const { TicketService } = await import('../../tickets/ticket-service')
      const service = new TicketService(db)

      const dueDate = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined

      await service.updateTicket({
        id: entityId,
        dueDate,
        organizationId,
        userId: undefined,
      })
    },
  },
}

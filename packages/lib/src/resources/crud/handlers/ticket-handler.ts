// // packages/lib/src/resources/crud/handlers/ticket-handler.ts

// import { TicketService } from '../../../tickets/ticket-service'
// import type { TicketType, TicketPriority, TicketStatus } from '@auxx/database/types'
// import { toResourceId } from '@auxx/types/resource'
// import type { ResourceHandler } from './types'
// import type { CrudResult, CrudContext, TransformedData } from '../types'
// import { trackChanges, type FieldChange } from '../utils/change-tracker'
// import { setCustomFields } from '../utils/custom-fields'

// /** Fields to track changes for in ticket events */
// const TRACKED_FIELDS = ['title', 'description', 'priority', 'status', 'dueDate', 'assignedToId']

// /**
//  * Ticket CRUD handler.
//  * Uses TicketService for DB operations.
//  * Publishes events after successful operations.
//  */
// export const ticketHandler: ResourceHandler = {
//   supports: (resourceType) => resourceType === 'ticket',

//   async create(data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
//     const { standardFields, customFields } = data
//     const { db, organizationId, userId } = ctx

//     // Validate required fields
//     if (!standardFields.title) {
//       return { success: false, error: 'Title is required', field: 'title' }
//     }
//     if (!standardFields.type) {
//       return { success: false, error: 'Type is required', field: 'type' }
//     }
//     if (!standardFields.contactId) {
//       return { success: false, error: 'Contact is required', field: 'contactId' }
//     }

//     try {
//       const ticketService = new TicketService(db)

//       const ticket = await ticketService.createTicket({
//         organizationId,
//         userId,
//         title: standardFields.title as string,
//         description: standardFields.description as string | undefined,
//         type: standardFields.type as TicketType,
//         priority: standardFields.priority as TicketPriority | undefined,
//         status: standardFields.status as TicketStatus | undefined,
//         contactId: standardFields.contactId as string,
//         assignedToId: standardFields.assignedToId as string | undefined,
//         dueDate: standardFields.dueDate
//           ? new Date(standardFields.dueDate as string)
//           : undefined,
//         parentTicketId: standardFields.parentTicketId as string | undefined,
//         typeData: standardFields.typeData as Record<string, unknown> | undefined,
//         typeStatus: standardFields.typeStatus as string | undefined,
//       })

//       // Set custom fields in batch
//       if (Object.keys(customFields).length > 0) {
//         const resourceId = toResourceId('ticket', ticket.id)
//         await setCustomFields(resourceId, customFields, ctx)
//       }

//       // Note: TicketService already publishes 'ticket:created' event

//       return { success: true, id: ticket.id, record: ticket }
//     } catch (error) {
//       return {
//         success: false,
//         error: error instanceof Error ? error.message : 'Failed to create ticket',
//       }
//     }
//   },

//   async update(id: string, data: TransformedData, ctx: CrudContext): Promise<CrudResult> {
//     const { standardFields, customFields } = data
//     const { db, organizationId, userId } = ctx

//     try {
//       const ticketService = new TicketService(db)

//       // Get existing ticket for change tracking if events not skipped
//       let changes: FieldChange[] = []
//       if (!ctx.skipEvents) {
//         const existing = await ticketService.getTicketById(id, organizationId)
//         if (existing) {
//           changes = trackChanges(existing as Record<string, unknown>, standardFields, TRACKED_FIELDS)
//         }
//       }

//       const ticket = await ticketService.updateTicket({
//         id,
//         organizationId,
//         userId,
//         title: standardFields.title as string | undefined,
//         description: standardFields.description as string | undefined,
//         priority: standardFields.priority as TicketPriority | undefined,
//         status: standardFields.status as TicketStatus | undefined,
//         dueDate: standardFields.dueDate
//           ? new Date(standardFields.dueDate as string)
//           : undefined,
//         typeData: standardFields.typeData as Record<string, unknown> | undefined,
//         typeStatus: standardFields.typeStatus as string | undefined,
//       })

//       // Set custom fields in batch
//       if (Object.keys(customFields).length > 0) {
//         const resourceId = toResourceId('ticket', id)
//         await setCustomFields(resourceId, customFields, ctx)
//       }

//       // Note: TicketService already publishes 'ticket:updated' event

//       return { success: true, id, record: ticket }
//     } catch (error) {
//       const message = error instanceof Error ? error.message : 'Failed to update ticket'
//       if (message.includes('not found')) {
//         return { success: false, error: `Ticket ${id} not found`, errorCode: 'NOT_FOUND' }
//       }
//       return { success: false, error: message }
//     }
//   },

//   async delete(id: string, ctx: CrudContext): Promise<CrudResult> {
//     const { db, organizationId, userId } = ctx

//     try {
//       const ticketService = new TicketService(db)
//       await ticketService.deleteTicket(id, organizationId, userId)

//       // Note: TicketService already publishes 'ticket:deleted' event

//       return { success: true, id }
//     } catch (error) {
//       const message = error instanceof Error ? error.message : 'Failed to delete ticket'
//       if (message.includes('not found')) {
//         return { success: false, error: `Ticket ${id} not found`, errorCode: 'NOT_FOUND' }
//       }
//       return { success: false, error: message }
//     }
//   },
// }

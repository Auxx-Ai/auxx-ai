// packages/lib/src/tickets/index.ts

export * from './types'
export * from './validation'
export * from './ticket-service'
export * from './ticket-service-factory'
export * from './ticket-dashboard-service'
export { ticketNumbering } from './ticket-numbering'
export { addRelation, removeRelation } from './ticket-relations'
export type { AddRelationInput, RemoveRelationInput } from './ticket-relations'
export {
  updateMultipleStatus,
  updateMultiplePriority,
  updateMultipleAssignments,
  deleteMultipleTickets,
} from './ticket-mutations'
export type {
  UpdateMultipleStatusInput,
  UpdateMultiplePriorityInput,
  UpdateMultipleAssignmentsInput,
  DeleteMultipleTicketsInput,
} from './ticket-mutations'

export { ticketMergeService } from './ticket-merge'

// packages/lib/src/tickets/index.ts

export * from './ticket-dashboard-service'
export { ticketMergeService } from './ticket-merge'
export type {
  DeleteMultipleTicketsInput,
  UpdateMultipleAssignmentsInput,
  UpdateMultiplePriorityInput,
  UpdateMultipleStatusInput,
} from './ticket-mutations'
export {
  deleteMultipleTickets,
  updateMultipleAssignments,
  updateMultiplePriority,
  updateMultipleStatus,
} from './ticket-mutations'
export { ticketNumbering } from './ticket-numbering'
export type { AddRelationInput, RemoveRelationInput } from './ticket-relations'
export { addRelation, removeRelation } from './ticket-relations'
export * from './ticket-service'
export * from './ticket-service-factory'
export * from './types'
export * from './validation'

// packages/lib/src/dispatch/index.ts
//
// Server entrypoint for the dispatch (field-service work orders) feature.
// Functional + neverthrow-style, no model classes (dashboards module is the layout precedent).

export { convertRequestToWorkOrder } from './convert-to-work-order'
export { createWorkOrderFromTicket } from './create-from-ticket'
export type { ConvertRequestToWorkOrderInput, CreateFromTicketInput } from './types'
export { ensureVisitOnWorkOrderCreate } from './visit-hooks'
export { ensureVisitForWorkOrder } from './visit-mutations'

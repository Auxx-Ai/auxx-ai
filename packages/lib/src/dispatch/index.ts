// packages/lib/src/dispatch/index.ts
//
// Server entrypoint for the dispatch (field-service work orders) feature.
// Functional style, plain AuxxError throws, no model classes.

export type { BoardResult, BoardWorkOrder, GetBoardRange } from './board'
export { getBoard, listVisitsForWorkOrder } from './board'
export type { VisitChangedPayload } from './broadcast'
export { publishVisitChanged } from './broadcast'
export { convertRequestToWorkOrder } from './convert-to-work-order'
export { createWorkOrderFromTicket } from './create-from-ticket'
export type { LifecycleTrigger } from './lifecycle'
export { rollUpWorkOrderStatus } from './lifecycle'
export { mirrorVisitOntoWorkOrder } from './mirror'
export { dispatchVisit } from './notify'
export type {
  AssignVisitInput,
  ConvertRequestToWorkOrderInput,
  CreateFromTicketInput,
  DispatchVisitInput,
  ScheduleVisitInput,
  SetVisitStatusInput,
  UnscheduleVisitInput,
  VisitStatus,
} from './types'
export { VISIT_STATUS_VALUES } from './types'
export { ensureVisitOnWorkOrderCreate } from './visit-hooks'
export {
  afterVisitWrite,
  assignVisit,
  ensureVisitForWorkOrder,
  scheduleVisit,
  setVisitStatus,
  unscheduleVisit,
} from './visit-mutations'
export type { DispatchWorkerWithUser, UpsertDispatchWorkerInput } from './workers'
export {
  listDispatchWorkers,
  removeDispatchWorker,
  setWorkerActive,
  upsertDispatchWorker,
} from './workers'

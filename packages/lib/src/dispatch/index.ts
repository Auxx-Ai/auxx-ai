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
export type {
  AdvanceMyVisitInput,
  CloseMyVisitInput,
  CloseMyVisitResult,
  GetMyVisitDetailInput,
  ListMyVisitsInput,
  MyVisitDetail,
  MyVisitDetailLine,
  MyVisitDetailWorkOrder,
  MyVisitListItem,
} from './my-schedule'
export {
  advanceMyVisit,
  closeMyVisit,
  getMyVisitDetail,
  listMyVisits,
  loadOwnVisit,
} from './my-schedule'
export { dispatchVisit } from './notify'
export type {
  AddMyAdhocQcItemInput,
  AddMyQcItemPhotoInput,
  CreateQcItemTemplateInput,
  ListMyVisitQcItemsResult,
  MyVisitQcItem,
  MyVisitQcItemPhoto,
  RemoveMyQcItemPhotoInput,
  ReorderQcItemTemplateUpdate,
  SetMyQcItemCheckedInput,
  SetMyQcItemNoteInput,
  UpdateQcItemTemplateInput,
} from './qc'
export {
  addMyAdhocQcItem,
  addMyQcItemPhoto,
  createQcItemTemplate,
  listMyVisitQcItems,
  listQcItemTemplates,
  removeMyQcItemPhoto,
  reorderQcItemTemplates,
  setMyQcItemChecked,
  setMyQcItemNote,
  updateQcItemTemplate,
} from './qc'
export type { EngagementActionInput, RecurrenceTemplate, SetRecurrenceRuleInput } from './recurring'
export {
  endEngagement,
  getWorkOrderStatus,
  materializeVisits,
  pauseEngagement,
  resumeEngagement,
  setRecurrenceRule,
  sweepRecurringVisits,
} from './recurring'
export type { ApplyRouteTimesInput, ApplyRouteTimesStop } from './route-planner/apply-times'
export { applyRouteTimes } from './route-planner/apply-times'
export type { BackfillGeocodeResult } from './route-planner/backfill'
export { backfillGeocodeVisits } from './route-planner/backfill'
export { resolveRouteStart } from './route-planner/depot'
export { getRouteGeometryForWorker, getRouteLegs } from './route-planner/directions'
export { getRoutePlannerBoard } from './route-planner/planner-board'
export type { SetRouteOrderInput } from './route-planner/route-order'
export { setRouteOrder } from './route-planner/route-order'
export type { SuggestStopInput } from './route-planner/suggest'
export { haversineMeters, suggestRouteOrder } from './route-planner/suggest'
export type {
  LatLng,
  PlannerBoardResult,
  PlannerDayWindow,
  PlannerWorker,
  PlannerWorkOrder,
  RouteGeometry,
  RouteLeg,
  RouteStop,
} from './route-planner/types'
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

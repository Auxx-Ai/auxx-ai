// packages/lib/src/dispatch/index.ts
//
// Server entrypoint for the dispatch (field-service work orders) feature.
// Functional style, plain AuxxError throws, no model classes.

export type { BoardResult, BoardWorkOrder, GetBoardRange, VisitDayMarker } from './board'
export { getBoard, getVisitDayMarkers, listVisitsForWorkOrder } from './board'
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
export { dispatchVisit, getWorkOrderLabel } from './notify'
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
  deleteQcItemTemplate,
  listMyVisitQcItems,
  listQcItemTemplates,
  listVisitQcItems,
  removeMyQcItemPhoto,
  reorderQcItemTemplates,
  setMyQcItemChecked,
  setMyQcItemNote,
  updateQcItemTemplate,
} from './qc'
export type {
  CancelVisitFollowingInput,
  EngagementActionInput,
  RecurrenceTemplate,
  SetRecurrenceRuleInput,
  SetSeriesEndInput,
} from './recurring'
export {
  cancelVisitFollowing,
  endEngagement,
  getWorkOrderStatus,
  materializeVisits,
  maybeEndExhaustedEngagement,
  pauseEngagement,
  resumeEngagement,
  setRecurrenceRule,
  setSeriesEnd,
  sweepRecurringVisits,
} from './recurring'
export type {
  ApplyRouteTimesInput,
  AutoApplyRouteTimesInput,
} from './route-planner/apply-times'
export { applyRouteTimes, autoApplyRouteTimes } from './route-planner/apply-times'
export type { BackfillGeocodeResult } from './route-planner/backfill'
export { backfillGeocodeVisits } from './route-planner/backfill'
export { resolveOrgDepot, resolveRouteStart } from './route-planner/depot'
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
  ReturnLeg,
  RouteGeometry,
  RouteLeg,
  RouteStop,
} from './route-planner/types'
export type {
  AddVisitInput,
  AssignVisitInput,
  ConvertRequestToWorkOrderInput,
  CreateFromTicketInput,
  DispatchVisitInput,
  RestoreVisitInput,
  ScheduleVisitInput,
  SetVisitDurationInput,
  SetVisitStatusInput,
  UnscheduleVisitInput,
  VisitStatus,
} from './types'
export { resolveVisitDurationMinutes, VISIT_STATUS_VALUES } from './types'
export { ensureVisitOnWorkOrderCreate } from './visit-hooks'
export {
  addVisit,
  afterVisitWrite,
  assignVisit,
  ensureVisitForWorkOrder,
  restoreVisit,
  scheduleVisit,
  setVisitDuration,
  setVisitStatus,
  unscheduleVisit,
} from './visit-mutations'
export type {
  NotifyVisitCanceledInput,
  NotifyVisitReassignedInput,
  NotifyVisitRescheduledInput,
} from './worker-notifications'
export {
  notifyVisitCanceled,
  notifyVisitReassigned,
  notifyVisitRescheduled,
} from './worker-notifications'
export type { DispatchWorkerWithUser, UpsertDispatchWorkerInput } from './workers'
export {
  listDispatchWorkers,
  removeDispatchWorker,
  setWorkerActive,
  upsertDispatchWorker,
} from './workers'

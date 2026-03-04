// packages/lib/src/timeline/index.ts

export { ContactTimelineTracker } from './contact-timeline-tracker'
export {
  ContactEventType,
  EntityInstanceEventType,
  SYSTEM_ENTITY_TYPES,
  TicketEventType,
  TimelineActorType,
  TimelineEntityType,
  type TimelineEventType,
} from './event-types'
export {
  type GroupedTimelineData,
  getPeriodTitle,
  getPeriodType,
  groupTimelineEventsByPeriod,
  MONTH_NAMES,
  type PeriodType,
  PeriodTypes,
  type TimelinePeriodGroup,
} from './timeline-periods'
export { TimelineService } from './timeline-service'
export type {
  CreateTimelineEventInput,
  GroupedTimelineEvent,
  SingleTimelineEvent,
  TimelineActor,
  TimelineCursor,
  TimelineEventBase,
  TimelineItem,
  TimelineQueryInput,
  TimelineQueryResult,
} from './types'

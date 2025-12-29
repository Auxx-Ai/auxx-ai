// packages/lib/src/timeline/client.ts
// Client-safe timeline exports (no server dependencies)

export {
  TimelineEntityType,
  TimelineActorType,
  ContactEventType,
  EntityInstanceEventType,
  ENTITY_TYPE_PREFIX,
  SYSTEM_ENTITY_TYPES,
  isSystemEntityType,
  isCustomEntityType,
  getEntityDefinitionId,
  createCustomEntityType,
  type TimelineEventType,
} from './event-types'

export type {
  TimelineActor,
  TimelineEventBase,
  SingleTimelineEvent,
  GroupedTimelineEvent,
  TimelineItem,
  TimelineQueryInput,
  TimelineQueryResult,
  CreateTimelineEventInput,
  TimelineCursor,
} from './types'

export {
  groupTimelineEventsByPeriod,
  getPeriodType,
  getPeriodTitle,
  PeriodTypes,
  MONTH_NAMES,
  type PeriodType,
  type TimelinePeriodGroup,
  type GroupedTimelineData,
} from './timeline-periods'

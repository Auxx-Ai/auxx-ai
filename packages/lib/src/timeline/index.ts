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
  TIMELINE_SNAPSHOT_ARRAY_LIMIT,
  TIMELINE_SNAPSHOT_BODY_LIMIT,
  TIMELINE_SNAPSHOT_LABEL_LIMIT,
  type TimelineActorSnapshot,
  type TimelineBooleanSnapshot,
  type TimelineDateSnapshot,
  type TimelineFieldChangeSnapshot,
  type TimelineFieldChangeSnapshotValue,
  type TimelineFileSnapshot,
  type TimelineJsonSnapshot,
  type TimelineNumberSnapshot,
  type TimelineOptionSnapshot,
  type TimelineRelationshipSnapshot,
  type TimelineRichTextSnapshot,
  type TimelineTextSnapshot,
  truncateForSnapshot,
} from './field-change-snapshot'
export { legacyTypedFieldValueToSnapshot } from './legacy-snapshot'
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
  TimelineChange,
  TimelineCursor,
  TimelineEventBase,
  TimelineItem,
  TimelineQueryInput,
  TimelineQueryResult,
} from './types'

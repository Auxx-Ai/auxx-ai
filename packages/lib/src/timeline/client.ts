// packages/lib/src/timeline/client.ts
// Client-safe timeline exports (no server dependencies)

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
  type TimelineFieldChangeSnapshot,
  type TimelineFieldChangeSnapshotValue,
  type TimelineSnapshotActor,
  type TimelineSnapshotBoolean,
  type TimelineSnapshotDate,
  type TimelineSnapshotFile,
  type TimelineSnapshotJson,
  type TimelineSnapshotNumber,
  type TimelineSnapshotOption,
  type TimelineSnapshotRelationship,
  type TimelineSnapshotText,
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

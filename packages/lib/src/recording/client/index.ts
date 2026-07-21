// packages/lib/src/recording/client/index.ts

export type {
  BotMediaUrls,
  BotProviderId,
  BotStatus,
  BotWebhookEventType,
  MeetingPlatform,
  RecordingOutcome,
} from '../bot/types'
export {
  BOT_PROVIDER_IDS,
  BOT_STATUSES,
  deriveRecordingOutcome,
  FAILURE_TERMINAL_STATUSES,
  formatRecordingFailure,
  MEETING_PLATFORMS,
  TERMINAL_STATUSES,
} from '../bot/types'
export type {
  CalendarEventListFilters,
  CalendarEventListResult,
  CalendarEventWithParticipants,
  CalendarSyncResult,
  MeetingPlatformValue,
  ResolvedParticipant,
  UpcomingMeetingSummary,
} from '../calendar/types'

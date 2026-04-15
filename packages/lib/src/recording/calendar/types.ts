// packages/lib/src/recording/calendar/types.ts

import type { CalendarEventEntity, MeetingParticipantEntity } from '@auxx/database'
import type { Result } from 'neverthrow'

/**
 * Meeting platform values supported by calendar sync.
 */
export type MeetingPlatformValue = NonNullable<CalendarEventEntity['meetingPlatform']>

/**
 * Minimal participant shape extracted from calendar providers.
 */
export interface CalendarAttendeeInput {
  email: string
  name?: string | null
  responseStatus?: string | null
  self?: boolean
  organizer?: boolean
}

/**
 * Normalized organizer data persisted on CalendarEvent rows.
 */
export interface CalendarOrganizerValue {
  email?: string | null
  name?: string | null
  self?: boolean
}

/**
 * URL parsing result for online meetings.
 */
export interface MeetingUrlMatch {
  url: string
  platform: MeetingPlatformValue
}

/**
 * Filters used when listing synced calendar events.
 */
export interface CalendarEventListFilters {
  from?: Date
  to?: Date
  userId?: string
  status?: CalendarEventEntity['status']
  limit?: number
  cursor?: string
}

/**
 * Paginated calendar-event list response.
 */
export interface CalendarEventListResult {
  items: CalendarEventEntity[]
  nextCursor?: string
}

/**
 * Calendar event with resolved participant rows.
 */
export interface CalendarEventWithParticipants extends CalendarEventEntity {
  participants: MeetingParticipantEntity[]
}

/**
 * Upcoming meeting summary returned to the UI.
 */
export interface UpcomingMeetingSummary extends CalendarEventEntity {
  participantCount: number
  linkedMeetingId: string | null
}

/**
 * Resolved participant information used for Meeting creation and participant persistence.
 */
export interface ResolvedParticipant {
  name: string
  email: string
  emailDomain: string
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needs_action'
  isOrganizer: boolean
  isBot: boolean
  isExternal: boolean
  userId: string | null
  contactEntityInstanceId: string | null
  companyEntityInstanceId: string | null
}

/**
 * Aggregate sync statistics returned by the orchestrator.
 */
export interface CalendarSyncResult {
  syncedEvents: number
  qualifyingEvents: number
  createdMeetings: number
  updatedMeetings: number
  linkedParticipants: number
  nextSyncToken: string | null
  usedFallbackWindow: boolean
  meetingSyncError?: string
}

/**
 * Common Result alias used by recording/calendar services.
 */
export type RecordingResult<T> = Promise<Result<T, Error>>

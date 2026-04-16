// packages/lib/src/recording/recording-queries.ts

import {
  type CalendarEventEntity,
  type CallRecordingEntity,
  type CallRecordingInsert,
  database as db,
  type MeetingParticipantEntity,
  schema,
} from '@auxx/database'
import { and, desc, eq, gte, inArray, isNotNull, lte, type SQL } from 'drizzle-orm'
import type { BotStatus } from './bot/types'

// ---------------------------------------------------------------------------
// findRecording
// ---------------------------------------------------------------------------

interface FindRecordingFilter {
  id?: string
  organizationId?: string
  externalBotId?: string
  calendarEventId?: string
  status?: BotStatus | BotStatus[]
}

interface FindRecordingOptionsSingle {
  skipOrganizationId?: boolean
  multi?: false
}

interface FindRecordingOptionsMulti {
  skipOrganizationId?: boolean
  multi: true
}

/** Find a single recording matching the filter. */
export async function findRecording(
  filter: FindRecordingFilter,
  options?: FindRecordingOptionsSingle
): Promise<CallRecordingEntity | undefined>

/** Find all recordings matching the filter. */
export async function findRecording(
  filter: FindRecordingFilter,
  options: FindRecordingOptionsMulti
): Promise<CallRecordingEntity[]>

export async function findRecording(
  filter: FindRecordingFilter,
  options?: FindRecordingOptionsSingle | FindRecordingOptionsMulti
): Promise<CallRecordingEntity | CallRecordingEntity[] | undefined> {
  if (!options?.skipOrganizationId && !filter.organizationId) {
    throw new Error('findRecording: organizationId is required unless skipOrganizationId is true')
  }

  const conditions: SQL[] = []

  if (filter.id) {
    conditions.push(eq(schema.CallRecording.id, filter.id))
  }
  if (filter.organizationId) {
    conditions.push(eq(schema.CallRecording.organizationId, filter.organizationId))
  }
  if (filter.externalBotId) {
    conditions.push(eq(schema.CallRecording.externalBotId, filter.externalBotId))
  }
  if (filter.calendarEventId) {
    conditions.push(eq(schema.CallRecording.calendarEventId, filter.calendarEventId))
  }
  if (filter.status) {
    if (Array.isArray(filter.status)) {
      conditions.push(inArray(schema.CallRecording.status, filter.status))
    } else {
      conditions.push(eq(schema.CallRecording.status, filter.status))
    }
  }

  const query = db
    .select()
    .from(schema.CallRecording)
    .where(and(...conditions))

  if (options?.multi) {
    return query
  }

  const [row] = await query.limit(1)
  return row
}

// ---------------------------------------------------------------------------
// updateRecording
// ---------------------------------------------------------------------------

interface UpdateRecordingFilter {
  id: string
  organizationId?: string
}

interface UpdateRecordingParams {
  status?: BotStatus
  externalBotId?: string
  failureReason?: string
  startedAt?: Date
  endedAt?: Date
  metadata?: Record<string, unknown>
  videoAssetId?: string
  audioAssetId?: string
}

interface UpdateRecordingOptions {
  skipOrganizationId?: boolean
}

/** Update a recording by id. Returns the updated row or undefined. */
export async function updateRecording(
  filter: UpdateRecordingFilter,
  params: UpdateRecordingParams,
  options?: UpdateRecordingOptions
): Promise<CallRecordingEntity | undefined> {
  if (!options?.skipOrganizationId && !filter.organizationId) {
    throw new Error('updateRecording: organizationId is required unless skipOrganizationId is true')
  }

  const conditions: SQL[] = [eq(schema.CallRecording.id, filter.id)]

  if (filter.organizationId) {
    conditions.push(eq(schema.CallRecording.organizationId, filter.organizationId))
  }

  const [updated] = await db
    .update(schema.CallRecording)
    .set(params)
    .where(and(...conditions))
    .returning()

  return updated
}

// ---------------------------------------------------------------------------
// createCallRecording
// ---------------------------------------------------------------------------

/** Insert a new CallRecording row. */
export async function createCallRecording(data: CallRecordingInsert): Promise<void> {
  await db.insert(schema.CallRecording).values(data)
}

// ---------------------------------------------------------------------------
// findOrgsWithRecordingEnabled
// ---------------------------------------------------------------------------

/** Find all organizations that have recording.enabled = true. */
export async function findOrgsWithRecordingEnabled() {
  return db
    .select()
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.key, 'recording.enabled'),
        eq(schema.OrganizationSetting.value, true)
      )
    )
}

// ---------------------------------------------------------------------------
// findUpcomingCalendarEvents
// ---------------------------------------------------------------------------

/** Find confirmed calendar events with a meeting URL starting within the given window. */
export async function findUpcomingCalendarEvents(params: {
  organizationId: string
  from: Date
  to: Date
}) {
  return db
    .select()
    .from(schema.CalendarEvent)
    .where(
      and(
        eq(schema.CalendarEvent.organizationId, params.organizationId),
        eq(schema.CalendarEvent.status, 'confirmed'),
        isNotNull(schema.CalendarEvent.meetingUrl),
        gte(schema.CalendarEvent.startTime, params.from),
        lte(schema.CalendarEvent.startTime, params.to)
      )
    )
}

// ---------------------------------------------------------------------------
// listRecordings
// ---------------------------------------------------------------------------

interface ListRecordingsParams {
  organizationId: string
  status?: BotStatus
  fromDate?: Date
  toDate?: Date
  calendarEventId?: string
  cursor?: string
  limit: number
}

interface ListRecordingsResult {
  items: (CallRecordingEntity & { calendarEvent: CalendarEventEntity | null })[]
  nextCursor: string | undefined
}

/** List recordings with optional filters, cursor pagination, and calendar event data. */
export async function listRecordings(params: ListRecordingsParams): Promise<ListRecordingsResult> {
  const { organizationId, status, fromDate, toDate, calendarEventId, cursor, limit } = params

  const conditions: SQL[] = [eq(schema.CallRecording.organizationId, organizationId)]

  if (status) {
    conditions.push(eq(schema.CallRecording.status, status))
  }
  if (fromDate) {
    conditions.push(gte(schema.CallRecording.createdAt, fromDate))
  }
  if (toDate) {
    conditions.push(lte(schema.CallRecording.createdAt, toDate))
  }
  if (calendarEventId) {
    conditions.push(eq(schema.CallRecording.calendarEventId, calendarEventId))
  }
  if (cursor) {
    conditions.push(lte(schema.CallRecording.createdAt, new Date(cursor)))
  }

  const recordings = await db
    .select()
    .from(schema.CallRecording)
    .where(and(...conditions))
    .orderBy(desc(schema.CallRecording.createdAt))
    .limit(limit + 1)

  const hasMore = recordings.length > limit
  const items = hasMore ? recordings.slice(0, limit) : recordings
  const nextCursor = hasMore ? items[items.length - 1]?.createdAt?.toISOString() : undefined

  // Join calendar event data for meeting titles
  const calendarEventIds = items.map((r) => r.calendarEventId).filter((id): id is string => !!id)

  let calendarEvents: Record<string, CalendarEventEntity> = {}
  if (calendarEventIds.length > 0) {
    const events = await db
      .select()
      .from(schema.CalendarEvent)
      .where(inArray(schema.CalendarEvent.id, calendarEventIds))

    calendarEvents = Object.fromEntries(events.map((e) => [e.id, e]))
  }

  return {
    items: items.map((recording) => ({
      ...recording,
      calendarEvent: recording.calendarEventId
        ? (calendarEvents[recording.calendarEventId] ?? null)
        : null,
    })),
    nextCursor,
  }
}

// ---------------------------------------------------------------------------
// getRecordingDetail
// ---------------------------------------------------------------------------

interface RecordingDetail {
  recording: CallRecordingEntity
  calendarEvent: CalendarEventEntity | null
  participants: MeetingParticipantEntity[]
}

/** Get a single recording with its calendar event and meeting participants. */
export async function getRecordingDetail(
  id: string,
  organizationId: string
): Promise<RecordingDetail | undefined> {
  const recording = await findRecording({ id, organizationId })
  if (!recording) return undefined

  let calendarEvent: CalendarEventEntity | null = null
  if (recording.calendarEventId) {
    const [event] = await db
      .select()
      .from(schema.CalendarEvent)
      .where(eq(schema.CalendarEvent.id, recording.calendarEventId))
      .limit(1)
    calendarEvent = event ?? null
  }

  let participants: MeetingParticipantEntity[] = []
  if (recording.calendarEventId) {
    participants = await db
      .select()
      .from(schema.MeetingParticipant)
      .where(eq(schema.MeetingParticipant.calendarEventId, recording.calendarEventId))
  }

  return { recording, calendarEvent, participants }
}

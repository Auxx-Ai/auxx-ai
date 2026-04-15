// packages/lib/src/recording/recording-queries.ts

import {
  type CallRecordingEntity,
  type CallRecordingInsert,
  database as db,
  schema,
} from '@auxx/database'
import { and, eq, gte, inArray, isNotNull, lte, type SQL } from 'drizzle-orm'
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
        eq(schema.OrganizationSetting.value, 'true')
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

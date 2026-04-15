// packages/lib/src/recording/calendar/calendar-event-service.ts

import { type CalendarEventInsert, database as db, schema } from '@auxx/database'
import { and, asc, desc, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type {
  CalendarEventListFilters,
  CalendarEventListResult,
  CalendarEventWithParticipants,
  RecordingResult,
  UpcomingMeetingSummary,
} from './types'

/**
 * Upsert a single calendar event using the provider-level unique key.
 */
export async function upsertCalendarEvent(event: CalendarEventInsert): RecordingResult<string> {
  try {
    const [row] = await db
      .insert(schema.CalendarEvent)
      .values(event)
      .onConflictDoUpdate({
        target: [
          schema.CalendarEvent.organizationId,
          schema.CalendarEvent.provider,
          schema.CalendarEvent.externalId,
        ],
        set: event,
      })
      .returning({ id: schema.CalendarEvent.id })

    if (!row?.id) {
      return err(new Error('Failed to upsert calendar event'))
    }

    return ok(row.id)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Upsert multiple calendar events within a transaction.
 */
export async function upsertCalendarEvents(
  events: CalendarEventInsert[]
): RecordingResult<string[]> {
  try {
    if (events.length === 0) {
      return ok([])
    }

    const ids = await db.transaction(async (tx) => {
      const collectedIds: string[] = []

      for (const event of events) {
        const [row] = await tx
          .insert(schema.CalendarEvent)
          .values(event)
          .onConflictDoUpdate({
            target: [
              schema.CalendarEvent.organizationId,
              schema.CalendarEvent.provider,
              schema.CalendarEvent.externalId,
            ],
            set: event,
          })
          .returning({ id: schema.CalendarEvent.id })

        if (!row?.id) {
          throw new Error(`Failed to upsert calendar event ${event.externalId}`)
        }

        collectedIds.push(row.id)
      }

      return collectedIds
    })

    return ok(ids)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * List calendar events for an organization with cursor pagination.
 */
export async function listCalendarEvents(
  organizationId: string,
  filters: CalendarEventListFilters = {}
): RecordingResult<CalendarEventListResult> {
  try {
    const limit = Math.min(filters.limit ?? 25, 100)
    const conditions = [eq(schema.CalendarEvent.organizationId, organizationId)]

    if (filters.from) {
      conditions.push(gte(schema.CalendarEvent.startTime, filters.from))
    }

    if (filters.to) {
      conditions.push(lt(schema.CalendarEvent.startTime, filters.to))
    }

    if (filters.userId) {
      conditions.push(eq(schema.CalendarEvent.userId, filters.userId))
    }

    if (filters.status) {
      conditions.push(eq(schema.CalendarEvent.status, filters.status))
    }

    if (filters.cursor) {
      const [cursorDate, cursorId] = filters.cursor.split('|')
      if (cursorDate && cursorId) {
        conditions.push(
          sql`(${schema.CalendarEvent.startTime}, ${schema.CalendarEvent.id}) < (${new Date(cursorDate)}, ${cursorId})`
        )
      }
    }

    const rows = await db
      .select()
      .from(schema.CalendarEvent)
      .where(and(...conditions))
      .orderBy(desc(schema.CalendarEvent.startTime), desc(schema.CalendarEvent.id))
      .limit(limit + 1)

    let nextCursor: string | undefined
    const items = [...rows]

    if (items.length > limit) {
      const next = items.pop()
      if (next) {
        nextCursor = `${next.startTime.toISOString()}|${next.id}`
      }
    }

    return ok({ items, nextCursor })
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Get upcoming external meetings for an organization.
 */
export async function getUpcomingMeetings(
  organizationId: string,
  options: { limit?: number; userId?: string } = {}
): RecordingResult<UpcomingMeetingSummary[]> {
  try {
    const limit = Math.min(options.limit ?? 10, 50)
    const conditions = [
      eq(schema.CalendarEvent.organizationId, organizationId),
      gt(schema.CalendarEvent.startTime, new Date()),
      sql`${schema.CalendarEvent.status} != 'cancelled'`,
    ]

    if (options.userId) {
      conditions.push(eq(schema.CalendarEvent.userId, options.userId))
    }

    const rows = await db
      .select({
        event: schema.CalendarEvent,
        participantCount: sql<number>`count(${schema.MeetingParticipant.id})`.mapWith(Number),
      })
      .from(schema.CalendarEvent)
      .leftJoin(
        schema.MeetingParticipant,
        eq(schema.MeetingParticipant.calendarEventId, schema.CalendarEvent.id)
      )
      .where(and(...conditions))
      .groupBy(schema.CalendarEvent.id)
      .orderBy(asc(schema.CalendarEvent.startTime), asc(schema.CalendarEvent.id))
      .limit(limit)

    return ok(
      rows.map(({ event, participantCount }) => ({
        ...event,
        participantCount,
        linkedMeetingId: event.entityInstanceId ?? null,
      }))
    )
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Fetch a single calendar event and all linked participant rows.
 */
export async function getCalendarEventById(
  id: string,
  organizationId: string
): RecordingResult<CalendarEventWithParticipants | null> {
  try {
    const event = await db.query.CalendarEvent.findFirst({
      where: (calendarEvents, { and, eq }) =>
        and(eq(calendarEvents.id, id), eq(calendarEvents.organizationId, organizationId)),
    })

    if (!event) {
      return ok(null)
    }

    const participants = await db.query.MeetingParticipant.findMany({
      where: (participants, { and, eq }) =>
        and(eq(participants.calendarEventId, id), eq(participants.organizationId, organizationId)),
      orderBy: (participants, { desc, asc }) => [
        desc(participants.isOrganizer),
        asc(participants.name),
      ],
    })

    return ok({
      ...event,
      participants,
    })
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Link a calendar event to a Meeting entity and realign participant rows to that Meeting.
 */
export async function linkCalendarEventToMeeting(
  calendarEventId: string,
  entityInstanceId: string,
  organizationId: string
): RecordingResult<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.CalendarEvent)
        .set({ entityInstanceId })
        .where(
          and(
            eq(schema.CalendarEvent.id, calendarEventId),
            eq(schema.CalendarEvent.organizationId, organizationId)
          )
        )

      await tx
        .update(schema.MeetingParticipant)
        .set({ meetingId: entityInstanceId })
        .where(
          and(
            eq(schema.MeetingParticipant.calendarEventId, calendarEventId),
            eq(schema.MeetingParticipant.organizationId, organizationId)
          )
        )
    })

    return ok(undefined)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * List participant rows for a given calendar event.
 */
export async function listCalendarEventParticipants(
  calendarEventId: string,
  organizationId: string
): RecordingResult<(typeof schema.MeetingParticipant.$inferSelect)[]> {
  try {
    const participants = await db.query.MeetingParticipant.findMany({
      where: (participants, { and, eq }) =>
        and(
          eq(participants.calendarEventId, calendarEventId),
          eq(participants.organizationId, organizationId)
        ),
      orderBy: (participants, { desc, asc }) => [
        desc(participants.isOrganizer),
        asc(participants.name),
      ],
    })

    return ok(participants)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Convert unknown thrown values into Error instances.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error('Unknown calendar-event-service error')
}

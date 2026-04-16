// packages/lib/src/recording/calendar/google-calendar-sync.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { type Common, type calendar_v3, google } from 'googleapis'
import { err, ok } from 'neverthrow'
import { getCachedEntityDefId } from '../../cache'
import { ChannelTokenAccessor } from '../../providers/channel-token-accessor'
import { GoogleOAuthService } from '../../providers/google/google-oauth'
import { upsertCalendarEvents } from './calendar-event-service'
import {
  createMeetingFromCalendarEvent,
  syncMeetingEntityFromCalendarEvent,
} from './meeting-entity-service'
import { parseMeetingUrl } from './meeting-url-parser'
import { resolveParticipants, upsertMeetingParticipants } from './participant-resolver'
import type {
  CalendarAttendeeInput,
  CalendarOrganizerValue,
  CalendarSyncResult,
  RecordingResult,
} from './types'

type GaxiosError = Common.GaxiosError

/**
 * Logger for Google calendar sync operations.
 */
const logger = createScopedLogger('recording:google-calendar-sync')

/**
 * Sync Google Calendar events for a single integration.
 */
export async function syncCalendarForIntegration(ctx: {
  integrationId: string
  organizationId: string
  userId: string
}): RecordingResult<CalendarSyncResult> {
  try {
    const tokens = await ChannelTokenAccessor.getTokens(ctx.integrationId)
    if (!tokens.refreshToken) {
      return err(new Error(`Missing refresh token for integration ${ctx.integrationId}`))
    }

    const { client } = await GoogleOAuthService.getAuthenticatedClientForOrg(
      ctx.organizationId,
      tokens
    )
    const calendar = google.calendar({ version: 'v3', auth: client })
    const integration = await getIntegration(ctx.integrationId, ctx.organizationId)

    if (!integration) {
      return err(new Error(`Integration ${ctx.integrationId} not found`))
    }

    const meetingEntityDefId = await getCachedEntityDefId(ctx.organizationId, 'meeting')
    const meetingSyncError = meetingEntityDefId
      ? undefined
      : 'Meeting entity definition is missing. Ensure the system entity seeder and migration 005-meeting have been applied.'
    const orgDomains = await getOrganizationDomains(ctx.organizationId)
    const metadata = readCalendarMetadata(integration.metadata)
    const listed = await listGoogleEvents(calendar, metadata.calendarSyncToken)
    const syncTimestamp = new Date()
    const mappedEvents = listed.events.map((event) =>
      mapGoogleEventToInsert(event, ctx.organizationId, ctx.userId, orgDomains, syncTimestamp)
    )
    const upsertResult = await upsertCalendarEvents(mappedEvents)

    if (upsertResult.isErr()) {
      return err(upsertResult.error)
    }

    let qualifyingEvents = 0
    let createdMeetings = 0
    let updatedMeetings = 0
    let linkedParticipants = 0

    for (const eventId of upsertResult.value) {
      const event = await db.query.CalendarEvent.findFirst({
        where: (calendarEvents, { eq }) => eq(calendarEvents.id, eventId),
      })

      if (!event || !shouldCreateMeeting(event)) {
        continue
      }

      qualifyingEvents++
      if (!meetingEntityDefId) {
        continue
      }

      const participantsResult = await resolveParticipants(
        readCalendarAttendees(event.attendees),
        ctx.organizationId,
        orgDomains
      )

      if (participantsResult.isErr()) {
        logger.error('Failed to resolve calendar participants', {
          integrationId: ctx.integrationId,
          calendarEventId: event.id,
          error: participantsResult.error.message,
        })
        continue
      }

      let meetingId = event.entityInstanceId
      if (!meetingId) {
        const createdMeetingResult = await createMeetingFromCalendarEvent(
          event,
          ctx.organizationId,
          ctx.userId,
          participantsResult.value
        )

        if (createdMeetingResult.isErr()) {
          logger.error('Failed to create meeting from calendar event', {
            integrationId: ctx.integrationId,
            calendarEventId: event.id,
            error:
              createdMeetingResult.error.cause?.toString?.() ?? createdMeetingResult.error.message,
          })
          continue
        }

        meetingId = createdMeetingResult.value
        createdMeetings++
      } else {
        const syncMeetingResult = await syncMeetingEntityFromCalendarEvent(
          meetingId,
          event,
          ctx.organizationId,
          ctx.userId,
          participantsResult.value,
          meetingEntityDefId
        )

        if (syncMeetingResult.isErr()) {
          logger.error('Failed to update meeting from calendar event', {
            integrationId: ctx.integrationId,
            calendarEventId: event.id,
            meetingId,
            error: syncMeetingResult.error.message,
          })
          continue
        }

        updatedMeetings++
      }

      const participantUpsertResult = await upsertMeetingParticipants(
        meetingId,
        event.id,
        ctx.organizationId,
        participantsResult.value
      )

      if (participantUpsertResult.isErr()) {
        logger.error('Failed to upsert meeting participants', {
          integrationId: ctx.integrationId,
          calendarEventId: event.id,
          meetingId,
          error: participantUpsertResult.error.message,
        })
        continue
      }

      linkedParticipants += participantsResult.value.length
    }

    await updateCalendarMetadata(ctx.integrationId, integration.metadata, {
      calendarSyncToken: listed.nextSyncToken,
      lastCalendarSyncAt: syncTimestamp.toISOString(),
    })

    return ok({
      syncedEvents: mappedEvents.length,
      qualifyingEvents,
      createdMeetings,
      updatedMeetings,
      linkedParticipants,
      nextSyncToken: listed.nextSyncToken,
      usedFallbackWindow: listed.usedFallbackWindow,
      ...(meetingSyncError ? { meetingSyncError } : {}),
    })
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Fetch the integration row needed for sync orchestration.
 */
async function getIntegration(integrationId: string, organizationId: string) {
  return db.query.Integration.findFirst({
    where: (integrations, { and, eq }) =>
      and(eq(integrations.id, integrationId), eq(integrations.organizationId, organizationId)),
  })
}

/**
 * List Google calendar events using either syncToken or a fallback window.
 */
async function listGoogleEvents(
  calendar: calendar_v3.Calendar,
  syncToken: string | null
): Promise<{
  events: calendar_v3.Schema$Event[]
  nextSyncToken: string | null
  usedFallbackWindow: boolean
}> {
  try {
    if (syncToken) {
      return await listGoogleEventsWithSyncToken(calendar, syncToken)
    }
  } catch (error) {
    const gaxiosError = error as GaxiosError
    if (!isSyncTokenExpiredError(gaxiosError)) {
      throw error
    }

    logger.warn('Google calendar sync token expired, falling back to time window', {
      error: gaxiosError.message,
    })
  }

  return listGoogleEventsWithWindow(calendar)
}

/**
 * List incremental calendar changes with a sync token.
 */
async function listGoogleEventsWithSyncToken(calendar: calendar_v3.Calendar, syncToken: string) {
  const events: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      syncToken,
      pageToken,
      showDeleted: true,
      maxResults: 250,
    })

    events.push(...(response.data.items ?? []))
    pageToken = response.data.nextPageToken ?? undefined
    nextSyncToken = response.data.nextSyncToken ?? nextSyncToken
  } while (pageToken)

  return {
    events,
    nextSyncToken,
    usedFallbackWindow: false,
  }
}

/**
 * List an initial time-window snapshot of calendar events.
 */
async function listGoogleEventsWithWindow(calendar: calendar_v3.Calendar) {
  const events: calendar_v3.Schema$Event[] = []
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 7)
  const thirtyDaysForward = new Date(now)
  thirtyDaysForward.setDate(now.getDate() + 30)

  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: sevenDaysAgo.toISOString(),
      timeMax: thirtyDaysForward.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
      showDeleted: true,
      maxResults: 250,
    })

    events.push(...(response.data.items ?? []))
    pageToken = response.data.nextPageToken ?? undefined
    nextSyncToken = response.data.nextSyncToken ?? nextSyncToken
  } while (pageToken)

  return {
    events,
    nextSyncToken,
    usedFallbackWindow: true,
  }
}

/**
 * Map a Google Calendar event into the CalendarEvent insert payload.
 */
function mapGoogleEventToInsert(
  event: calendar_v3.Schema$Event,
  organizationId: string,
  userId: string,
  orgDomains: string[],
  syncedAt: Date
) {
  const meetingMatch = parseMeetingUrl({
    location: event.location,
    description: event.description,
    conferenceData: event.conferenceData,
  })
  const attendees = mapGoogleAttendees(event.attendees)
  const startValue = event.start?.dateTime ?? event.start?.date
  const endValue = event.end?.dateTime ?? event.end?.date ?? startValue

  if (!event.id || !startValue || !endValue) {
    throw new Error(`Google Calendar event is missing required fields: ${event.id ?? 'unknown'}`)
  }

  return {
    organizationId,
    userId,
    provider: 'google' as const,
    externalId: event.id,
    title: event.summary?.trim() || '(No title)',
    description: event.description ?? null,
    startTime: new Date(startValue),
    endTime: new Date(endValue),
    timezone: event.start?.timeZone || event.end?.timeZone || 'UTC',
    meetingUrl: meetingMatch?.url ?? null,
    meetingPlatform: meetingMatch?.platform ?? null,
    location: event.location ?? null,
    isAllDay: Boolean(event.start?.date && !event.start?.dateTime),
    status: normalizeCalendarStatus(event.status),
    organizer: mapGoogleOrganizer(event.organizer),
    attendees,
    isExternal: computeIsExternal(attendees, orgDomains),
    recurringEventId: event.recurringEventId ?? null,
    rawData: event,
    syncedAt,
  }
}

/**
 * Convert Google organizer data into the stored JSON shape.
 */
function mapGoogleOrganizer(
  organizer?: {
    email?: string | null
    displayName?: string | null
    self?: boolean | null
  } | null
): CalendarOrganizerValue {
  return {
    email: organizer?.email ?? null,
    name: organizer?.displayName ?? null,
    self: organizer?.self ?? false,
  }
}

/**
 * Convert Google attendees into the stored JSON attendee array.
 */
function mapGoogleAttendees(
  attendees?: calendar_v3.Schema$EventAttendee[] | null
): CalendarAttendeeInput[] {
  return (attendees ?? [])
    .map((attendee) => ({
      email: attendee.email?.trim().toLowerCase() ?? '',
      name: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      self: attendee.self ?? false,
      organizer: attendee.organizer ?? false,
    }))
    .filter((attendee) => attendee.email)
}

/**
 * Read attendee JSON from a persisted CalendarEvent row.
 */
function readCalendarAttendees(attendees: unknown): CalendarAttendeeInput[] {
  if (!Array.isArray(attendees)) {
    return []
  }

  return attendees.filter((attendee): attendee is CalendarAttendeeInput => {
    return Boolean(
      attendee &&
        typeof attendee === 'object' &&
        'email' in attendee &&
        typeof (attendee as { email?: unknown }).email === 'string'
    )
  })
}

/**
 * Determine whether an event includes external attendees.
 */
function computeIsExternal(attendees: CalendarAttendeeInput[], orgDomains: string[]): boolean {
  const normalizedOrgDomains = new Set(orgDomains.map((domain) => domain.toLowerCase()))
  return attendees.some((attendee) => {
    const attendeeDomain = attendee.email.split('@')[1]?.toLowerCase()
    return Boolean(attendeeDomain && !normalizedOrgDomains.has(attendeeDomain))
  })
}

/**
 * Normalize Google event status into the database enum.
 */
function normalizeCalendarStatus(status?: string | null): 'confirmed' | 'tentative' | 'cancelled' {
  switch (status) {
    case 'tentative':
      return 'tentative'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'confirmed'
  }
}

/**
 * Determine whether a synced calendar event should create/update a Meeting entity.
 */
function shouldCreateMeeting(event: typeof schema.CalendarEvent.$inferSelect): boolean {
  return event.isExternal && !event.isAllDay && event.status !== 'cancelled'
}

/**
 * Fetch the set of domains that should be treated as internal for an organization.
 */
export async function getOrganizationDomains(organizationId: string): Promise<string[]> {
  const domains = new Set<string>()
  const [organization] = await db
    .select({
      emailDomain: schema.Organization.emailDomain,
      website: schema.Organization.website,
    })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, organizationId))
    .limit(1)

  if (organization?.emailDomain) {
    domains.add(normalizeDomain(organization.emailDomain))
  }

  if (organization?.website) {
    const websiteDomain = extractDomainFromUrl(organization.website)
    if (websiteDomain) {
      domains.add(websiteDomain)
    }
  }

  const mailDomains = await db
    .select({ domain: schema.MailDomain.domain })
    .from(schema.MailDomain)
    .where(eq(schema.MailDomain.organizationId, organizationId))

  for (const row of mailDomains) {
    if (row.domain) {
      domains.add(normalizeDomain(row.domain))
    }
  }

  return Array.from(domains)
}

/**
 * Read calendar sync metadata from the integration row.
 */
function readCalendarMetadata(metadata: unknown): {
  calendarSyncToken: string | null
  calendarSyncEnabled: boolean
  lastCalendarSyncAt: string | null
} {
  if (!metadata || typeof metadata !== 'object') {
    return {
      calendarSyncToken: null,
      calendarSyncEnabled: false,
      lastCalendarSyncAt: null,
    }
  }

  const value = metadata as Record<string, unknown>
  return {
    calendarSyncToken: typeof value.calendarSyncToken === 'string' ? value.calendarSyncToken : null,
    calendarSyncEnabled: value.calendarSyncEnabled === true,
    lastCalendarSyncAt:
      typeof value.lastCalendarSyncAt === 'string' ? value.lastCalendarSyncAt : null,
  }
}

/**
 * Persist calendar sync metadata back to the Integration row.
 */
async function updateCalendarMetadata(
  integrationId: string,
  currentMetadata: unknown,
  updates: {
    calendarSyncToken: string | null
    lastCalendarSyncAt: string
  }
): Promise<void> {
  const nextMetadata = {
    ...(isRecord(currentMetadata) ? currentMetadata : {}),
    calendarSyncEnabled: true,
    calendarSyncToken: updates.calendarSyncToken,
    lastCalendarSyncAt: updates.lastCalendarSyncAt,
  }

  await db
    .update(schema.Integration)
    .set({
      metadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))
}

/**
 * Detect the Google sync-token expiration response.
 */
function isSyncTokenExpiredError(error: GaxiosError): boolean {
  return error.code === '410' || error.response?.status === 410
}

/**
 * Extract a hostname domain from a URL-like string.
 */
function extractDomainFromUrl(url: string): string | null {
  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`
    return normalizeDomain(new URL(normalizedUrl).hostname)
  } catch {
    return null
  }
}

/**
 * Normalize domains for reliable matching.
 */
function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

/**
 * Check whether a value is a plain object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/**
 * Convert unknown thrown values into Error instances.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error('Unknown google-calendar-sync error')
}

// packages/lib/src/recording/recording-service.ts

import type { CallRecordingEntity } from '@auxx/database'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { addMinutes } from 'date-fns'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { deleteAsset } from '../files/assets'
import { getAssetDownloadRef } from '../files/assets/download'
import type { FilesCtx } from '../files/ctx'
import { createS3StoragePort } from '../files/storage/ports'
import { createThumbnailCleanupPort } from '../files/thumbnails'
import { createGoogleMeetEvent } from '../providers/google/calendar/create-event'
import { getAllOrganizationSettings } from '../settings/settings-service'
import { scheduleBotForRecording } from './bot/bot-manager'
import { upsertCalendarEvent } from './calendar/calendar-event-service'
import { createMeetingDirect } from './calendar/create-meeting-direct'
import { getOrganizationDomains } from './calendar/google-calendar-sync'
import { createMeetingFromCalendarEvent } from './calendar/meeting-entity-service'
import { parseMeetingUrl } from './calendar/meeting-url-parser'
import {
  resolveContactEmails,
  resolveParticipants,
  upsertMeetingParticipants,
} from './calendar/participant-resolver'
import { findRecording } from './recording-queries'

// ---------------------------------------------------------------------------
// scheduleRecording
// ---------------------------------------------------------------------------

interface ScheduleRecordingParams {
  calendarEventId: string
  organizationId: string
  userId: string
  botName?: string
  consentMessage?: string
  captureVideo?: boolean
}

/** Validate calendar event, create a CallRecording row, and schedule the bot. */
export async function scheduleRecording(
  params: ScheduleRecordingParams
): Promise<Result<CallRecordingEntity, Error>> {
  const { calendarEventId, organizationId, userId, ...overrides } = params

  // Load the calendar event
  const [event] = await db
    .select()
    .from(schema.CalendarEvent)
    .where(
      and(
        eq(schema.CalendarEvent.id, calendarEventId),
        eq(schema.CalendarEvent.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!event) {
    return err(new NotFoundError('Calendar event not found'))
  }

  if (!event.meetingUrl) {
    return err(new Error('Calendar event has no meeting URL'))
  }

  // Get org recording settings
  const recordingSettings = await getAllOrganizationSettings({
    organizationId,
    scope: 'RECORDING',
  })

  const botName = overrides.botName ?? (recordingSettings['recording.defaultBotName'] as string)
  const consentMessage =
    overrides.consentMessage ?? (recordingSettings['recording.defaultConsentMessage'] as string)
  const captureVideo =
    overrides.captureVideo ?? (recordingSettings['recording.captureVideo'] as boolean)
  const botProvider = recordingSettings['recording.botProvider'] as string

  // Create the CallRecording row
  const recordingId = generateId()
  await db.insert(schema.CallRecording).values({
    id: recordingId,
    organizationId,
    meetingId: event.entityInstanceId!,
    calendarEventId: event.id,
    provider: botProvider as 'recall' | 'babl' | 'self_hosted',
    meetingPlatform:
      (event.meetingPlatform as 'google_meet' | 'teams' | 'zoom' | 'unknown') ?? 'unknown',
    status: 'created',
    botName,
    consentMessage,
    createdById: userId,
    updatedAt: new Date(),
  })

  // Schedule the bot
  return scheduleBotForRecording({
    recordingId,
    organizationId,
    meetingUrl: event.meetingUrl,
    meetingPlatform:
      (event.meetingPlatform as 'google_meet' | 'teams' | 'zoom' | 'unknown') ?? 'unknown',
    botName,
    consentMessage,
    captureVideo,
    joinAt: event.startTime,
  })
}

// ---------------------------------------------------------------------------
// getRecordingVideoUrl
// ---------------------------------------------------------------------------

interface RecordingVideoUrls {
  url: string | null
  storyboardUrl: string | null
  previewUrl: string | null
  message?: string
}

/** Get presigned video, storyboard, and preview-thumbnail URLs for a recording (15-min TTL). */
export async function getRecordingVideoUrl(
  id: string,
  organizationId: string
): Promise<RecordingVideoUrls> {
  const recording = await findRecording({ id, organizationId })

  if (!recording) {
    throw new NotFoundError('Recording not found')
  }

  if (!recording.videoAssetId) {
    return {
      url: null,
      storyboardUrl: null,
      previewUrl: null,
      message: 'Video not yet available',
    }
  }

  const ctx: FilesCtx = { db, organizationId }
  const deps = { storage: createS3StoragePort(organizationId) }

  // All three refs are now fail-soft. The storyboard and preview always were;
  // the main video used to throw when its asset had been deleted out from under
  // the recording, which surfaced as a 500 rather than the `url: null` this
  // function already documents for "not yet available".
  const [url, storyboardUrl, previewUrl] = await Promise.all([
    presignAssetUrl(ctx, deps, recording.videoAssetId),
    presignAssetUrl(ctx, deps, recording.videoStoryboardAssetId),
    presignAssetUrl(ctx, deps, recording.videoPreviewAssetId),
  ])

  return { url, storyboardUrl, previewUrl }
}

async function presignAssetUrl(
  ctx: FilesCtx,
  deps: { storage: ReturnType<typeof createS3StoragePort> },
  assetId: string | null
): Promise<string | null> {
  if (!assetId) return null
  // Asset may have been deleted out from under the recording; treat as missing.
  const ref = await getAssetDownloadRef(ctx, deps, assetId, { disposition: 'inline' })
  if (ref.isErr()) return null
  return ref.value.type === 'url' ? ref.value.url : null
}

// ---------------------------------------------------------------------------
// deleteRecording
// ---------------------------------------------------------------------------

/** Delete a recording and its associated media assets. */
export async function deleteRecording(
  id: string,
  organizationId: string,
  userId: string
): Promise<Result<void, Error>> {
  const recording = await findRecording({ id, organizationId })

  if (!recording) {
    return err(new NotFoundError('Recording not found'))
  }

  // Soft-delete media assets
  const assetIds = [
    recording.videoAssetId,
    recording.audioAssetId,
    recording.videoPreviewAssetId,
    recording.videoStoryboardAssetId,
  ].filter((id): id is string => !!id)

  if (assetIds.length > 0) {
    const now = () => new Date()
    const storage = createS3StoragePort(organizationId)
    for (const assetId of assetIds) {
      // One transaction per asset, matching the facade's per-call `getTx`. The
      // thumbnail sweep is built on `tx` so it sees this transaction's rows.
      await db.transaction(async (tx) => {
        const txCtx: FilesCtx = { db: tx, organizationId }
        const deleted = await deleteAsset(
          tx,
          txCtx,
          { now, thumbnails: createThumbnailCleanupPort(txCtx, { storage, now }) },
          assetId
        )
        if (deleted.isErr()) throw deleted.error
      })
    }
  }

  // Delete the recording row
  await db.delete(schema.CallRecording).where(eq(schema.CallRecording.id, id))

  return ok(undefined)
}

// ---------------------------------------------------------------------------
// createMeeting
// ---------------------------------------------------------------------------

interface CreateMeetingParams {
  organizationId: string
  userId: string
  title: string
  startTime: Date
  durationMinutes: number
  timezone: string
  contactRecordIds: RecordId[]
  createGoogleMeet: boolean
  meetingUrl?: string
  description?: string
}

interface CreateMeetingResult {
  meetingEntityId: string
  meetingUrl: string | null
}

const logger = createScopedLogger('recording:create-meeting')

/** Create a meeting — either via Google Meet (auto-creates calendar event) or manual URL. */
export async function createMeeting(
  params: CreateMeetingParams
): Promise<Result<CreateMeetingResult, Error>> {
  const { organizationId, userId, startTime, durationMinutes, contactRecordIds } = params
  const orgDomains = await getOrganizationDomains(organizationId)

  // Resolve emails from contact entity instances
  const attendees = await resolveContactEmails(contactRecordIds, organizationId, userId)
  logger.info('Resolved contact attendees', {
    contactCount: contactRecordIds.length,
    attendeeCount: attendees.length,
  })

  const participantsResult = await resolveParticipants(attendees, organizationId, orgDomains)
  if (participantsResult.isErr()) {
    return err(participantsResult.error)
  }

  if (params.createGoogleMeet) {
    return createMeetingViaGoogleMeet(params, attendees, participantsResult.value)
  }

  // Path B: Manual URL — create meeting entity directly
  const urlMatch = params.meetingUrl ? parseMeetingUrl({ location: params.meetingUrl }) : null

  const directResult = await createMeetingDirect({
    organizationId,
    userId,
    title: params.title,
    startTime,
    durationMinutes,
    meetingUrl: params.meetingUrl,
    meetingPlatform: urlMatch?.platform,
    participants: participantsResult.value,
  })

  if (directResult.isErr()) {
    return err(directResult.error)
  }

  return ok({
    meetingEntityId: directResult.value,
    meetingUrl: params.meetingUrl ?? null,
  })
}

/** Path A: Google Meet — create calendar event + meeting entity. */
async function createMeetingViaGoogleMeet(
  params: CreateMeetingParams,
  attendees: Array<{ email: string; name: string | null }>,
  participants: import('./calendar/types').ResolvedParticipant[]
): Promise<Result<CreateMeetingResult, Error>> {
  const { organizationId, userId, title, startTime, durationMinutes, timezone, description } =
    params
  const endTime = addMinutes(startTime, durationMinutes)

  const meetResult = await createGoogleMeetEvent({
    organizationId,
    userId,
    title,
    startTime,
    endTime,
    timezone,
    attendees: attendees.map((a) => ({ email: a.email, name: a.name ?? undefined })),
    description,
  })

  if (meetResult.isErr()) {
    return err(meetResult.error)
  }

  // Persist CalendarEvent row so the meeting entity can be linked
  const calendarEventResult = await upsertCalendarEvent({
    organizationId,
    userId,
    provider: 'google',
    externalId: meetResult.value.googleEventId,
    title,
    description: description ?? null,
    startTime,
    endTime,
    timezone,
    meetingUrl: meetResult.value.meetingUrl,
    meetingPlatform: 'google_meet',
    location: null,
    isAllDay: false,
    status: 'confirmed',
    organizer: { email: null, name: null, self: true },
    attendees: attendees.map((a) => ({
      email: a.email,
      name: a.name ?? null,
      responseStatus: 'needs_action',
      self: false,
      organizer: false,
    })),
    isExternal: true,
    recurringEventId: null,
    rawData: null,
    syncedAt: new Date(),
  })

  if (calendarEventResult.isErr()) {
    return err(calendarEventResult.error)
  }

  const calendarEventId = calendarEventResult.value

  // Fetch the persisted CalendarEvent to pass to createMeetingFromCalendarEvent
  const [calendarEvent] = await db
    .select()
    .from(schema.CalendarEvent)
    .where(eq(schema.CalendarEvent.id, calendarEventId))
    .limit(1)

  if (!calendarEvent) {
    return err(new Error('Calendar event was created but could not be retrieved'))
  }

  const meetingResult = await createMeetingFromCalendarEvent(
    calendarEvent,
    organizationId,
    userId,
    participants
  )

  if (meetingResult.isErr()) {
    return err(meetingResult.error)
  }

  await upsertMeetingParticipants(
    meetingResult.value,
    calendarEventId,
    organizationId,
    participants
  )

  logger.info('Created meeting via Google Meet', {
    meetingId: meetingResult.value,
    calendarEventId,
    participantCount: participants.length,
  })

  return ok({
    meetingEntityId: meetingResult.value,
    meetingUrl: meetResult.value.meetingUrl,
  })
}

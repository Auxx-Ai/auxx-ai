// packages/lib/src/providers/google/calendar/create-event.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { google } from 'googleapis'
import { err, ok } from 'neverthrow'
import type { RecordingResult } from '../../../recording/calendar/types'
import { GoogleOAuthService } from '../google-oauth'

const logger = createScopedLogger('google-calendar:create-event')

export interface CreateGoogleMeetParams {
  organizationId: string
  userId: string
  title: string
  startTime: Date
  endTime: Date
  timezone: string
  attendees: Array<{ email: string; name?: string }>
  description?: string
}

export interface CreateGoogleMeetResult {
  meetingUrl: string
  googleEventId: string
  calendarEventSummary: {
    title: string
    startTime: Date
    endTime: Date
    timezone: string
    attendees: Array<{ email: string; name?: string }>
    description?: string
  }
}

/**
 * Create a Google Calendar event with an auto-generated Google Meet link.
 */
export async function createGoogleMeetEvent(
  params: CreateGoogleMeetParams
): RecordingResult<CreateGoogleMeetResult> {
  try {
    const client = await GoogleOAuthService.getClientForOrganization(params.organizationId)
    const calendar = google.calendar({ version: 'v3', auth: client })

    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'all',
      requestBody: {
        summary: params.title,
        description: params.description ?? undefined,
        start: {
          dateTime: params.startTime.toISOString(),
          timeZone: params.timezone,
        },
        end: {
          dateTime: params.endTime.toISOString(),
          timeZone: params.timezone,
        },
        attendees: params.attendees.map((a) => ({
          email: a.email,
          displayName: a.name ?? undefined,
        })),
        conferenceData: {
          createRequest: {
            requestId: generateId(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    })

    const event = response.data
    if (!event.id) {
      return err(new Error('Google Calendar event was created but returned no event ID'))
    }

    const meetingUrl =
      event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri ?? null

    if (!meetingUrl) {
      logger.warn('Google Calendar event created but no Meet link was generated', {
        googleEventId: event.id,
        organizationId: params.organizationId,
      })
      return err(new Error('Google Meet link was not generated. Try again.'))
    }

    logger.info('Created Google Calendar event with Meet link', {
      googleEventId: event.id,
      organizationId: params.organizationId,
      meetingUrl,
    })

    return ok({
      meetingUrl,
      googleEventId: event.id,
      calendarEventSummary: {
        title: params.title,
        startTime: params.startTime,
        endTime: params.endTime,
        timezone: params.timezone,
        attendees: params.attendees,
        description: params.description,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error creating Google Meet'
    logger.error('Failed to create Google Calendar event', {
      error: message,
      organizationId: params.organizationId,
    })
    return err(new Error(`Failed to create Google Meet: ${message}`))
  }
}

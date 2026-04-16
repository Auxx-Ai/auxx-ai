// packages/lib/src/recording/bot/recording-scheduler.ts

import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { ok, type Result } from 'neverthrow'
import { SettingsService } from '../../settings/settings-service'
import {
  createCallRecording,
  findOrgsWithRecordingEnabled,
  findRecording,
  findUpcomingCalendarEvents,
} from '../recording-queries'
import { scheduleBotForRecording } from './bot-manager'
import { TERMINAL_STATUSES } from './types'

const logger = createScopedLogger('recording:scheduler')
const settingsService = new SettingsService()

/**
 * Scan for upcoming meetings and auto-schedule recording bots.
 * Runs as a cron job every 2 minutes.
 */
export async function scheduleBotsForUpcomingMeetings(): Promise<
  Result<{ scheduled: number; skipped: number }, Error>
> {
  const now = new Date()
  // Recall.ai requires ~10min lead time to guarantee the bot joins on time,
  // but still accepts shorter windows. We look 13min ahead for the ideal case,
  // and also pick up events that already started (up to 5min ago) to handle
  // last-minute manual scheduling or late calendar syncs.
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
  const thirteenMinutesFromNow = new Date(now.getTime() + 13 * 60 * 1000)

  let scheduled = 0
  let skipped = 0

  // Find organizations with recording enabled
  const orgSettings = await findOrgsWithRecordingEnabled()

  for (const orgSetting of orgSettings) {
    const organizationId = orgSetting.organizationId

    // Get all recording settings for this org in a single query
    const recordingSettings = await settingsService.getAllOrganizationSettings({
      organizationId,
      scope: 'RECORDING',
    })

    const botName = recordingSettings['recording.defaultBotName'] as string
    const consentMessage = recordingSettings['recording.defaultConsentMessage'] as string
    const captureVideo = recordingSettings['recording.captureVideo'] as boolean
    const botProvider = recordingSettings['recording.botProvider'] as string

    // Find upcoming calendar events with meeting URLs
    const upcomingEvents = await findUpcomingCalendarEvents({
      organizationId,
      from: fiveMinutesAgo,
      to: thirteenMinutesFromNow,
    })

    for (const event of upcomingEvents) {
      // Check for existing non-terminal recording for this event
      const eventRecordings = await findRecording(
        { calendarEventId: event.id, organizationId },
        { multi: true }
      )

      const hasActiveRecording = eventRecordings.some(
        (r) => !TERMINAL_STATUSES.includes(r.status as any)
      )

      if (hasActiveRecording) {
        skipped++
        continue
      }

      // Check user's autoRecord setting
      // TODO: Re-enable autoRecord filtering once the settings UI is built
      // const autoRecord = (await settingsService.getUserSetting({
      //   organizationId,
      //   userId: event.userId,
      //   key: 'recording.autoRecord',
      // })) as string
      //
      // if (autoRecord === 'none') {
      //   skipped++
      //   continue
      // }
      //
      // if (autoRecord === 'external' && !event.isExternal) {
      //   skipped++
      //   continue
      // }

      // Create CallRecording row
      const recordingId = generateId()
      await createCallRecording({
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
        createdById: event.userId,
        updatedAt: new Date(),
      })

      // Schedule the bot
      const result = await scheduleBotForRecording({
        recordingId,
        organizationId,
        meetingUrl: event.meetingUrl!,
        meetingPlatform:
          (event.meetingPlatform as 'google_meet' | 'teams' | 'zoom' | 'unknown') ?? 'unknown',
        botName,
        consentMessage,
        captureVideo,
        joinAt: event.startTime,
      })

      if (result.isOk()) {
        scheduled++
        logger.info('Bot auto-scheduled', {
          recordingId,
          calendarEventId: event.id,
          organizationId,
        })
      } else {
        logger.error('Failed to auto-schedule bot', {
          recordingId,
          calendarEventId: event.id,
          error: result.error.message,
        })
      }
    }
  }

  logger.info('Scheduler scan complete', { scheduled, skipped })
  return ok({ scheduled, skipped })
}

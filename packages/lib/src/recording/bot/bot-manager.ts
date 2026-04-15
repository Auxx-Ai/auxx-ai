// packages/lib/src/recording/bot/bot-manager.ts

import type { CallRecordingEntity } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { getQueue, Queues } from '../../jobs/queues'
import { SettingsService } from '../../settings/settings-service'
import { findRecording, updateRecording } from '../recording-queries'
import { getProvider } from './providers'
import type { BotProviderId, BotStatus } from './types'
import { STATUS_ORDINAL, TERMINAL_STATUSES } from './types'

const logger = createScopedLogger('recording:bot-manager')
const settingsService = new SettingsService()

/**
 * Schedule a bot to join a meeting and start recording.
 * Creates the provider bot and updates the CallRecording row.
 */
export async function scheduleBotForRecording(params: {
  recordingId: string
  organizationId: string
  meetingUrl: string
  meetingPlatform: 'google_meet' | 'teams' | 'zoom' | 'unknown'
  botName: string
  consentMessage?: string
  captureVideo: boolean
  joinAt?: Date
}): Promise<Result<CallRecordingEntity, Error>> {
  const {
    recordingId,
    organizationId,
    meetingUrl,
    meetingPlatform,
    botName,
    consentMessage,
    captureVideo,
    joinAt,
  } = params

  const botProvider = (await settingsService.getOrganizationSetting({
    organizationId,
    key: 'recording.botProvider',
  })) as string

  const provider = getProvider(botProvider as BotProviderId)

  const platform = meetingPlatform === 'unknown' ? 'google_meet' : meetingPlatform
  const createResult = await provider.createBot({
    meetingUrl,
    meetingPlatform: platform,
    botName,
    consentMessage,
    captureVideo,
    recordingId,
    organizationId,
    joinAt,
  })

  if (createResult.isErr()) {
    logger.error('Failed to create bot', { recordingId, error: createResult.error.message })
    return err(createResult.error)
  }

  const { externalBotId } = createResult.value

  const updated = await updateRecording(
    { id: recordingId, organizationId },
    { externalBotId, status: 'joining' }
  )

  if (!updated) {
    return err(new NotFoundError(`CallRecording ${recordingId} not found`))
  }

  logger.info('Bot scheduled for recording', {
    recordingId,
    externalBotId,
    meetingUrl,
  })

  // Enqueue a delayed timeout job (10 min from now or joinAt)
  const timeoutQueue = getQueue(Queues.recordingBotQueue)
  const delayMs = joinAt ? joinAt.getTime() - Date.now() + 10 * 60 * 1000 : 10 * 60 * 1000
  await timeoutQueue.add(
    'handleBotTimeoutJob',
    { recordingId },
    {
      delay: Math.max(delayMs, 0),
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    }
  )

  return ok(updated)
}

/**
 * Cancel a scheduled or active recording.
 */
export async function cancelBot(params: {
  recordingId: string
  organizationId: string
}): Promise<Result<void, Error>> {
  const { recordingId, organizationId } = params

  const recording = await findRecording({ id: recordingId, organizationId })

  if (!recording) {
    return err(new NotFoundError(`CallRecording ${recordingId} not found`))
  }

  if (TERMINAL_STATUSES.includes(recording.status as BotStatus)) {
    return ok(undefined)
  }

  if (recording.externalBotId) {
    const botProvider = (await settingsService.getOrganizationSetting({
      organizationId,
      key: 'recording.botProvider',
    })) as string

    const provider = getProvider(botProvider as BotProviderId)
    const removeResult = await provider.removeBot(recording.externalBotId)

    if (removeResult.isErr()) {
      logger.warn('Failed to remove bot from provider', {
        recordingId,
        externalBotId: recording.externalBotId,
        error: removeResult.error.message,
      })
    }
  }

  await updateRecording({ id: recordingId, organizationId }, { status: 'cancelled' })

  logger.info('Bot cancelled', { recordingId })
  return ok(undefined)
}

/**
 * Handle a bot status change from a webhook event.
 * Enforces forward-only transitions and enqueues downstream jobs.
 */
export async function handleBotStatusChange(params: {
  externalBotId: string
  newStatus: BotStatus
  subCode?: string
  metadata?: Record<string, unknown>
}): Promise<Result<CallRecordingEntity, Error>> {
  const { externalBotId, newStatus, subCode, metadata } = params

  const recording = await findRecording({ externalBotId }, { skipOrganizationId: true })

  if (!recording) {
    logger.warn('CallRecording not found for externalBotId', { externalBotId })
    return err(new NotFoundError(`CallRecording not found for bot ${externalBotId}`))
  }

  const currentStatus = recording.status as BotStatus

  // Ignore if already terminal
  if (TERMINAL_STATUSES.includes(currentStatus)) {
    logger.debug('Ignoring status change for terminal recording', {
      recordingId: recording.id,
      currentStatus,
      newStatus,
    })
    return ok(recording)
  }

  // Reject backward transitions (except terminal statuses which can come from any state)
  if (
    !TERMINAL_STATUSES.includes(newStatus) &&
    STATUS_ORDINAL[newStatus] <= STATUS_ORDINAL[currentStatus]
  ) {
    logger.debug('Ignoring backward status transition', {
      recordingId: recording.id,
      currentStatus,
      newStatus,
    })
    return ok(recording)
  }

  const updates: Record<string, unknown> = {
    status: newStatus,
  }

  if (newStatus === 'recording' && !recording.startedAt) {
    updates.startedAt = new Date()
  }

  if (TERMINAL_STATUSES.includes(newStatus) && !recording.endedAt) {
    updates.endedAt = new Date()
  }

  if (['failed', 'kicked', 'denied', 'timeout'].includes(newStatus)) {
    updates.failureReason = subCode ?? newStatus
  }

  if (metadata) {
    updates.metadata = { ...(recording.metadata as Record<string, unknown> | null), ...metadata }
  }

  const updated = await updateRecording(
    { id: recording.id, organizationId: recording.organizationId },
    updates as any
  )

  logger.info('Bot status updated', {
    recordingId: recording.id,
    oldStatus: currentStatus,
    newStatus,
    subCode,
  })

  // Enqueue media processing when recording completes
  if (newStatus === 'completed') {
    const processingQueue = getQueue(Queues.recordingProcessingQueue)
    await processingQueue.add(
      'processRecordingJob',
      { recordingId: recording.id, organizationId: recording.organizationId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      }
    )
  }

  return ok(updated!)
}

/**
 * Poll a bot's status from the provider and update if changed.
 */
export async function pollBotStatus(params: {
  recordingId: string
}): Promise<Result<BotStatus, Error>> {
  const { recordingId } = params

  const recording = await findRecording({ id: recordingId }, { skipOrganizationId: true })

  if (!recording) {
    return err(new NotFoundError(`CallRecording ${recordingId} not found`))
  }

  const currentStatus = recording.status as BotStatus
  if (TERMINAL_STATUSES.includes(currentStatus)) {
    return ok(currentStatus)
  }

  if (!recording.externalBotId) {
    return ok(currentStatus)
  }

  const provider = getProvider(recording.provider as BotProviderId)
  const statusResult = await provider.getBotStatus(recording.externalBotId)

  if (statusResult.isErr()) {
    logger.warn('Failed to poll bot status', {
      recordingId,
      error: statusResult.error.message,
    })
    return err(statusResult.error)
  }

  const { status: providerStatus } = statusResult.value

  if (providerStatus !== currentStatus) {
    const updateResult = await handleBotStatusChange({
      externalBotId: recording.externalBotId,
      newStatus: providerStatus,
    })

    if (updateResult.isErr()) {
      return err(updateResult.error)
    }

    return ok(providerStatus)
  }

  return ok(currentStatus)
}

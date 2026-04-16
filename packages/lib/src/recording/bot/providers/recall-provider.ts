// packages/lib/src/recording/bot/providers/recall-provider.ts

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../../errors'
import type {
  BotMediaUrls,
  BotProvider,
  BotStatus,
  BotWebhookEvent,
  BotWebhookEventType,
  CreateBotParams,
  ExternalBotInstance,
  ExternalBotStatus,
  ExternalTranscriptData,
  ExternalUtterance,
} from '../types'

const logger = createScopedLogger('recording:recall-provider')

// --- Recall.ai API Error ---

export class RecallApiError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string,
    public endpoint: string
  ) {
    super(`Recall API error ${statusCode} on ${endpoint}: ${responseBody}`)
    this.name = 'RecallApiError'
  }
}

// --- Status Mapping ---

const RECALL_STATUS_MAP: Record<string, BotStatus> = {
  // Webhook format (with 'bot.' prefix)
  'bot.joining_call': 'joining',
  'bot.in_waiting_room': 'waiting',
  'bot.in_call_not_recording': 'admitted',
  'bot.recording_permission_allowed': 'admitted',
  'bot.recording_permission_denied': 'denied',
  'bot.in_call_recording': 'recording',
  'bot.call_ended': 'processing',
  'bot.done': 'completed',
  'bot.fatal': 'failed',
  // API response format (without 'bot.' prefix)
  joining_call: 'joining',
  in_waiting_room: 'waiting',
  in_call_not_recording: 'admitted',
  recording_permission_allowed: 'admitted',
  recording_permission_denied: 'denied',
  in_call_recording: 'recording',
  call_ended: 'processing',
  done: 'completed',
  fatal: 'failed',
}

function mapRecallStatus(recallStatus: string): BotStatus | undefined {
  return RECALL_STATUS_MAP[recallStatus]
}

// --- Recall.ai Webhook Event Mapping ---

const RECALL_EVENT_MAP: Record<string, BotWebhookEventType> = {
  // Each Recall.ai status is its own webhook event
  'bot.joining_call': 'bot.status_change',
  'bot.in_waiting_room': 'bot.status_change',
  'bot.in_call_not_recording': 'bot.status_change',
  'bot.recording_permission_allowed': 'bot.status_change',
  'bot.recording_permission_denied': 'bot.status_change',
  'bot.in_call_recording': 'bot.status_change',
  'bot.call_ended': 'bot.status_change',
  'bot.done': 'bot.status_change',
  'bot.fatal': 'bot.status_change',
  // Media/transcript events
  'recording.done': 'bot.recording_ready',
  'transcript.done': 'bot.transcript_ready',
}

// --- HTTP Client ---

interface RecallApiClientConfig {
  apiKey: string
  region: string
  webhookSecret: string
}

function createRecallApiClient(config: RecallApiClientConfig) {
  const baseUrl = `https://${config.region}.recall.ai/api/v1`

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`

    logger.debug('Recall API request', { method, path })

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Token ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new RecallApiError(res.status, text, path)
    }

    if (res.status === 204) {
      return undefined as T
    }

    return res.json() as T
  }

  return { request }
}

// --- Map Recall API errors to AuxxErrors ---

function mapRecallApiError(error: RecallApiError): Error {
  switch (error.statusCode) {
    case 400:
      return new BadRequestError(`Recall.ai: ${error.responseBody}`)
    case 401:
      return new UnauthorizedError('Recall.ai: invalid API key')
    case 404:
      return new NotFoundError('Recall.ai: bot not found')
    default:
      return error
  }
}

// --- Recall.ai API Response Types ---

interface RecallBotResponse {
  id: string
  status_changes: { code: string; created_at: string }[]
  media_shortcuts?: {
    video_mixed?: { data?: { download_url?: string } }
    audio_mixed?: { data?: { download_url?: string } }
  }
  metadata?: Record<string, unknown>
  join_at?: string
}

interface RecallTranscriptResponse {
  results: {
    speaker: string
    speaker_id: number
    words: { text: string; start_timestamp: number; end_timestamp: number }[]
  }[]
}

// --- Provider Implementation ---

export function createRecallProvider(config: RecallApiClientConfig): BotProvider {
  const client = createRecallApiClient(config)

  return {
    id: 'recall',

    async createBot(params: CreateBotParams): Promise<Result<ExternalBotInstance, Error>> {
      try {
        const body: Record<string, unknown> = {
          meeting_url: params.meetingUrl,
          bot_name: params.botName,
          recording_config: {
            audio_mixed_mp3: {},
            ...(params.captureVideo ? { video_mixed_mp4: {} } : {}),
            transcript: {
              provider: {
                recallai_streaming: {
                  mode: 'prioritize_accuracy',
                },
              },
            },
          },
          automatic_leave: {
            waiting_room_timeout: 300,
            noone_joined_timeout: 300,
            everyone_left_timeout: 30,
          },
          metadata: {
            recording_id: params.recordingId,
            organization_id: params.organizationId,
          },
        }

        if (params.consentMessage) {
          body.chat = {
            on_bot_join: {
              send_to: 'everyone',
              message: params.consentMessage,
            },
          }
        }

        if (params.joinAt) {
          body.join_at = params.joinAt.toISOString()
        }

        const response = await client.request<RecallBotResponse>('POST', '/bot/', body)

        logger.info('Bot created', {
          externalBotId: response.id,
          recordingId: params.recordingId,
          meetingUrl: params.meetingUrl,
        })

        return ok({
          externalBotId: response.id,
          provider: 'recall',
          status: 'joining',
        })
      } catch (error) {
        if (error instanceof RecallApiError) {
          return err(mapRecallApiError(error))
        }
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    async removeBot(externalBotId: string): Promise<Result<void, Error>> {
      try {
        await client.request('DELETE', `/bot/${externalBotId}/`)
        logger.info('Bot removed', { externalBotId })
        return ok(undefined)
      } catch (error) {
        if (error instanceof RecallApiError) {
          return err(mapRecallApiError(error))
        }
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    async getBotStatus(externalBotId: string): Promise<Result<ExternalBotStatus, Error>> {
      try {
        const response = await client.request<RecallBotResponse>('GET', `/bot/${externalBotId}/`)
        const statusChanges = response.status_changes ?? []
        const lastStatus = statusChanges[statusChanges.length - 1]

        if (!lastStatus) {
          return ok({ status: 'created' })
        }

        const mappedStatus = mapRecallStatus(lastStatus.code)
        if (!mappedStatus) {
          logger.warn('Unknown Recall status', { code: lastStatus.code, externalBotId })
          return ok({ status: 'created' })
        }

        const joinedChange = statusChanges.find((s) => s.code === 'bot.in_call_not_recording')
        const recordingChange = statusChanges.find((s) => s.code === 'bot.in_call_recording')
        const endedChange = statusChanges.find(
          (s) => s.code === 'bot.call_ended' || s.code === 'bot.done'
        )

        return ok({
          status: mappedStatus,
          joinedAt: joinedChange ? new Date(joinedChange.created_at) : undefined,
          recordingStartedAt: recordingChange ? new Date(recordingChange.created_at) : undefined,
          recordingEndedAt: endedChange ? new Date(endedChange.created_at) : undefined,
        })
      } catch (error) {
        if (error instanceof RecallApiError) {
          return err(mapRecallApiError(error))
        }
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    async getMediaUrl(externalBotId: string): Promise<Result<BotMediaUrls, Error>> {
      try {
        const response = await client.request<RecallBotResponse>('GET', `/bot/${externalBotId}/`)

        // Media shortcuts live on recordings[0], not on the bot root
        const recording = (response as any).recordings?.[0]
        const mediaShortcuts = recording?.media_shortcuts ?? response.media_shortcuts

        const videoUrl = mediaShortcuts?.video_mixed?.data?.download_url
        const audioUrl = mediaShortcuts?.audio_mixed?.data?.download_url

        return ok({
          videoUrl: videoUrl ?? undefined,
          audioUrl: audioUrl ?? undefined,
        })
      } catch (error) {
        if (error instanceof RecallApiError) {
          return err(mapRecallApiError(error))
        }
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    async getTranscript(
      externalBotId: string
    ): Promise<Result<ExternalTranscriptData | null, Error>> {
      try {
        const response = await client.request<RecallTranscriptResponse>(
          'GET',
          `/bot/${externalBotId}/transcript/`
        )

        if (!response.results || response.results.length === 0) {
          return ok(null)
        }

        const utterances: ExternalUtterance[] = response.results.map((result) => {
          const words = result.words ?? []
          const text = words.map((w) => w.text).join(' ')
          const startMs = words[0]?.start_timestamp ?? 0
          const endMs = words[words.length - 1]?.end_timestamp ?? 0

          return {
            speakerName: result.speaker,
            speakerId: String(result.speaker_id),
            text,
            startMs,
            endMs,
            words: words.map((w) => ({
              text: w.text,
              startMs: w.start_timestamp,
              endMs: w.end_timestamp,
            })),
          }
        })

        return ok({ utterances })
      } catch (error) {
        if (error instanceof RecallApiError) {
          // 404 means no transcript available
          if (error.statusCode === 404) {
            return ok(null)
          }
          return err(mapRecallApiError(error))
        }
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    parseWebhook(headers: Record<string, string>, body: unknown): Result<BotWebhookEvent, Error> {
      try {
        const payload = body as {
          event?: string
          data?: {
            data?: Record<string, unknown>
            bot?: string | { id?: string; metadata?: Record<string, unknown> }
          }
        }

        if (!payload.event || !payload.data?.bot) {
          return err(new BadRequestError('Invalid webhook payload: missing event or bot'))
        }

        const eventType = RECALL_EVENT_MAP[payload.event]
        if (!eventType) {
          return err(new BadRequestError(`Unknown webhook event: ${payload.event}`))
        }

        // data.bot can be a string (bot ID) or an object { id, metadata }
        const botField = payload.data.bot
        const externalBotId = typeof botField === 'string' ? botField : botField?.id
        if (!externalBotId) {
          return err(new BadRequestError('Invalid webhook payload: missing bot ID'))
        }

        const statusData = payload.data.data ?? {}

        let status: BotStatus | undefined
        if (eventType === 'bot.status_change') {
          status = mapRecallStatus(payload.event!)
        }

        const event: BotWebhookEvent = {
          type: eventType,
          externalBotId,
          timestamp: new Date(),
          status,
          subCode: typeof statusData.sub_code === 'string' ? statusData.sub_code : undefined,
          metadata:
            typeof statusData.metadata === 'object' && statusData.metadata !== null
              ? (statusData.metadata as Record<string, unknown>)
              : undefined,
        }

        return ok(event)
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)))
      }
    },

    verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean {
      const msgId = headers['webhook-id']
      const timestamp = headers['webhook-timestamp']
      const signatures = headers['webhook-signature']

      if (!msgId || !timestamp || !signatures) {
        return false
      }

      // Reject timestamps older than 5 minutes to prevent replay attacks
      const timestampSeconds = Number.parseInt(timestamp, 10)
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - timestampSeconds) > 300) {
        return false
      }

      const toSign = `${msgId}.${timestamp}.${rawBody}`
      const secretBytes = Buffer.from(config.webhookSecret.replace('whsec_', ''), 'base64')
      const expected = createHmac('sha256', secretBytes).update(toSign).digest('base64')

      // svix-signature can contain multiple signatures (key rotation), space-separated
      return signatures.split(' ').some((sig) => {
        const value = sig.replace('v1,', '')
        try {
          return timingSafeEqual(Buffer.from(expected), Buffer.from(value))
        } catch {
          return false
        }
      })
    },
  }
}

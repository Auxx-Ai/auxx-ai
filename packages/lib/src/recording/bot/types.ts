// packages/lib/src/recording/bot/types.ts

import type { Result } from 'neverthrow'

// --- Provider IDs ---

export const BOT_PROVIDER_IDS = ['recall', 'babl', 'self_hosted'] as const
export type BotProviderId = (typeof BOT_PROVIDER_IDS)[number]

// --- Meeting Platforms ---

export const MEETING_PLATFORMS = ['google_meet', 'teams', 'zoom'] as const
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number]

// --- Bot Status ---

export const BOT_STATUSES = [
  'created',
  'joining',
  'waiting',
  'admitted',
  'recording',
  'processing',
  'completed',
  'failed',
  'kicked',
  'denied',
  'timeout',
  'cancelled',
] as const
export type BotStatus = (typeof BOT_STATUSES)[number]

/** Terminal statuses — no further transitions possible */
export const TERMINAL_STATUSES: BotStatus[] = [
  'completed',
  'failed',
  'kicked',
  'denied',
  'timeout',
  'cancelled',
]

/** Terminal statuses where the bot ended without a usable recording */
export const FAILURE_TERMINAL_STATUSES: BotStatus[] = [
  'failed',
  'kicked',
  'denied',
  'timeout',
  'cancelled',
]

/**
 * Recall sub_codes (attached to call_ended/done/fatal status changes) that mean
 * the bot ended without ever recording. Maps to the truthful terminal status.
 * See https://docs.recall.ai/docs/sub-codes
 */
export const FAILURE_SUB_CODE_STATUS: Record<string, BotStatus> = {
  timeout_exceeded_waiting_room: 'timeout',
  call_ended_by_platform_waiting_room_timeout: 'timeout',
  timeout_exceeded_noone_joined: 'timeout',
  google_meet_bot_blocked: 'denied',
  zoom_bot_blocked: 'denied',
  meeting_not_accessible: 'denied',
  meeting_not_found: 'failed',
  meeting_not_started: 'failed',
  bot_errored: 'failed',
}

/** Human-readable failure reasons keyed by sub_code (fallbacks by BotStatus). */
export const FAILURE_REASONS: Record<string, string> = {
  timeout_exceeded_waiting_room: 'The notetaker was never admitted to the meeting',
  call_ended_by_platform_waiting_room_timeout: 'The notetaker was never admitted to the meeting',
  timeout_exceeded_noone_joined: 'No one joined the meeting',
  google_meet_bot_blocked: 'The notetaker was blocked from joining the meeting',
  zoom_bot_blocked: 'The notetaker was blocked from joining the meeting',
  meeting_not_accessible: 'The meeting was not accessible to the notetaker',
  meeting_not_found: 'The meeting could not be found',
  meeting_not_started: 'The meeting never started',
  bot_errored: 'The notetaker encountered an unexpected error',
  // Status-level fallbacks
  timeout: 'The notetaker was never admitted to the meeting',
  denied: 'The notetaker was denied entry to the meeting',
  kicked: 'The notetaker was removed from the meeting',
  failed: 'The notetaker failed to record the meeting',
  cancelled: 'The recording was cancelled',
}

/** Best human-readable copy for a stored failureReason / sub_code / status. */
export function formatRecordingFailure(reason: string | null | undefined): string {
  if (!reason) return 'The meeting ended without a recording'
  return FAILURE_REASONS[reason] ?? reason
}

// --- Recording Outcome (derived, drives UI states) ---

export type RecordingOutcome = 'scheduled' | 'live' | 'ready' | 'no_recording'

/**
 * Collapse bot status + captured artifacts into the single outcome the UI
 * should render: pre-meeting, in-progress, usable recording, or nothing captured.
 */
export function deriveRecordingOutcome(recording: {
  status: BotStatus | string
  hasTranscript?: boolean
  videoAssetId?: string | null
}): RecordingOutcome {
  const status = recording.status as BotStatus
  if (FAILURE_TERMINAL_STATUSES.includes(status)) return 'no_recording'
  if (status === 'completed') {
    return recording.hasTranscript || recording.videoAssetId ? 'ready' : 'no_recording'
  }
  if (status === 'created' || status === 'joining') return 'scheduled'
  return 'live'
}

/** Ordered status progression for forward-transition enforcement */
export const STATUS_ORDINAL: Record<BotStatus, number> = {
  created: 0,
  joining: 1,
  waiting: 2,
  admitted: 3,
  recording: 4,
  processing: 5,
  completed: 6,
  failed: 6,
  kicked: 6,
  denied: 6,
  timeout: 6,
  cancelled: 6,
}

// --- Provider Interface ---

export interface BotProvider {
  id: BotProviderId

  /** Create a bot and instruct it to join a meeting */
  createBot(params: CreateBotParams): Promise<Result<ExternalBotInstance, Error>>

  /** Remove bot from meeting early */
  removeBot(externalBotId: string): Promise<Result<void, Error>>

  /** Get current bot status from the provider */
  getBotStatus(externalBotId: string): Promise<Result<ExternalBotStatus, Error>>

  /** Get media download URL after recording completes */
  getMediaUrl(externalBotId: string): Promise<Result<BotMediaUrls, Error>>

  /** Get transcript data (if provider supports transcription) */
  getTranscript(externalBotId: string): Promise<Result<ExternalTranscriptData | null, Error>>

  /** Parse and normalize an inbound webhook payload */
  parseWebhook(headers: Record<string, string>, body: unknown): Result<BotWebhookEvent, Error>

  /** Verify webhook signature */
  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean
}

// --- Create Bot Params ---

export interface CreateBotParams {
  meetingUrl: string
  meetingPlatform: MeetingPlatform
  botName: string
  consentMessage?: string
  joinAt?: Date
  autoLeaveAfterMinutes?: number
  captureVideo: boolean
  /** Our internal recording ID — passed as metadata, returned in webhooks */
  recordingId: string
  organizationId: string
}

// --- External Bot Instance (returned by provider on create) ---

export interface ExternalBotInstance {
  externalBotId: string
  provider: BotProviderId
  status: BotStatus
}

// --- External Bot Status (from provider polling) ---

export interface ExternalBotStatus {
  status: BotStatus
  subCode?: string
  joinedAt?: Date
  recordingStartedAt?: Date
  recordingEndedAt?: Date
}

// --- Media URLs ---

export interface BotMediaUrls {
  videoUrl?: string
  audioUrl?: string
  expiresAt?: Date
}

// --- Webhook Event ---

export type BotWebhookEventType =
  | 'bot.status_change'
  | 'bot.recording_ready'
  | 'bot.transcript_ready'

export interface BotWebhookEvent {
  type: BotWebhookEventType
  externalBotId: string
  timestamp: Date
  status?: BotStatus
  subCode?: string
  metadata?: Record<string, unknown>
}

// --- External Transcript ---

export interface ExternalTranscriptData {
  utterances: ExternalUtterance[]
  language?: string
}

export interface ExternalUtterance {
  speakerName: string
  speakerId: string
  text: string
  startMs: number
  endMs: number
  words?: { text: string; startMs: number; endMs: number }[]
}

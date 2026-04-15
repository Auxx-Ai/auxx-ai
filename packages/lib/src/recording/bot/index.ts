// packages/lib/src/recording/bot/index.ts

export {
  cancelBot,
  handleBotStatusChange,
  pollBotStatus,
  scheduleBotForRecording,
} from './bot-manager'
export { downloadAndStoreRecordingMedia } from './media-downloader'
export { getProvider } from './providers'
export { scheduleBotsForUpcomingMeetings } from './recording-scheduler'
export type {
  BotMediaUrls,
  BotProvider,
  BotProviderId,
  BotStatus,
  BotWebhookEvent,
  BotWebhookEventType,
  CreateBotParams,
  ExternalBotInstance,
  ExternalBotStatus,
  ExternalTranscriptData,
  ExternalUtterance,
  MeetingPlatform,
} from './types'
export {
  BOT_PROVIDER_IDS,
  BOT_STATUSES,
  MEETING_PLATFORMS,
  STATUS_ORDINAL,
  TERMINAL_STATUSES,
} from './types'
export { handleRecordingWebhook } from './webhook-handler'

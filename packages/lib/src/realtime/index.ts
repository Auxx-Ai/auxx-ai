// @auxx/lib/realtime/index.ts

import { PusherRealtimeProvider } from './providers/pusher'
import { RealtimeService } from './realtime-service'

let instance: RealtimeService | null = null

/** Get the singleton RealtimeService instance. */
export function getRealtimeService(): RealtimeService {
  if (!instance) {
    instance = new RealtimeService(new PusherRealtimeProvider())
  }
  return instance
}

export type {
  AiStatus,
  AiValueMetadata,
  FieldValuesUpdatedEvent,
  FieldValueUpdateEntry,
  MailBatchEvent,
  MailSyncEvent,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageMeta,
  MessageUpdatedEvent,
  ParticipantMeta,
  ParticipantUpdatedEvent,
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
  RecordMeta,
  RecordUpdatedEvent,
  ResourceSyncEvent,
  StoredFieldValue,
  ThreadCreatedEvent,
  ThreadDeletedEvent,
  ThreadMeta,
  ThreadUpdatedEvent,
} from './events'
export {
  flushMailBatch,
  publishFieldValueUpdates,
  publishMessageCreated,
  publishMessageDeleted,
  publishMessageUpdated,
  publishParticipantUpdated,
  publishThreadCreated,
  publishThreadDeleted,
  publishThreadUpdated,
} from './publish-helpers'
export { RealtimeService } from './realtime-service'
export type { RealtimeProvider } from './types'

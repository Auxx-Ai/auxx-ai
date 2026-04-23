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
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
  RecordMeta,
  RecordUpdatedEvent,
  ResourceSyncEvent,
  StoredFieldValue,
} from './events'
export { publishFieldValueUpdates } from './publish-helpers'
export { RealtimeService } from './realtime-service'
export type { RealtimeProvider } from './types'

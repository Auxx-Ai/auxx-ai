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
  AgentUpdatedEvent,
  AiStatus,
  AiValueMetadata,
  DataConnectorSyncEvent,
  DataExportJobEvent,
  EvalCaseChangedEvent,
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
  ProcedureUpdatedEvent,
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
  RecordMeta,
  RecordsInvalidatedEvent,
  RecordUpdatedEvent,
  ResourceDefChangedEvent,
  ResourceSyncEvent,
  StoredFieldValue,
  TableViewChangedEvent,
  ThreadCreatedEvent,
  ThreadDeletedEvent,
  ThreadMeta,
  ThreadUpdatedEvent,
} from './events'
export {
  flushMailBatch,
  publishAgentUpdated,
  publishDataConnectorSync,
  publishDataExportJob,
  publishEvalCaseChanged,
  publishFieldValueUpdates,
  publishInboxSyncCompleted,
  publishMessageCreated,
  publishMessageDeleted,
  publishMessageUpdated,
  publishParticipantUpdated,
  publishProcedureUpdated,
  publishRecordsInvalidated,
  publishResourceDefChanged,
  publishTableViewChanged,
  publishThreadCreated,
  publishThreadDeleted,
  publishThreadUpdated,
} from './publish-helpers'
export { RealtimeService } from './realtime-service'
export {
  type AuthorizeCtx,
  findRoom,
  findRoomByChannel,
  fromPusherChannel,
  type RoomDef,
  type RoomKind,
  roomKindFor,
  rooms,
  toPusherChannel,
} from './rooms'
export type { RealtimeProvider } from './types'

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
  ApprovalPingEvent,
  ApprovalResolvedEvent,
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
  VisibilityChangedEvent,
} from './events'
export { shapeMailEventForLens } from './mail-event-shaping'
export {
  flushMailBatch,
  publishAgentUpdated,
  publishApprovalPing,
  publishApprovalResolved,
  publishCapabilitiesChanged,
  publishCountsChanged,
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
  CHANNEL_LENSES,
  type ChannelLens,
  findRoom,
  findRoomByChannel,
  fromPusherChannel,
  parseInboxRoomKey,
  parseRecordRoomKey,
  type RecordRoomKey,
  type RoomDef,
  type RoomKind,
  roomKindFor,
  rooms,
  toPusherChannel,
} from './rooms'
export type { RealtimeProvider } from './types'

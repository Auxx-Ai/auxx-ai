// packages/lib/src/workflow-engine/types/message.ts

import type {
  ParticipantEntity as Participant,
  MessageParticipantEntity as MessageParticipant,
  ThreadEntity as Thread,
  OrganizationEntity as Organization,
  MessageEntity as Message,
} from '@auxx/database/models'

/**
 * ProcessedMessage extends Message with all necessary relations
 * for workflow execution context
 */
export interface ProcessedMessage extends Message {
  participants: MessageParticipant[]
  thread?: Thread
  from: Participant
  replyTo?: Participant | null
  organization: Organization
}

/**
 * Processing mode for workflow execution
 */
export enum ProcessingMode {
  AUTOMATIC = 'AUTOMATIC',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

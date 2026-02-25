// packages/lib/src/workflow-engine/types/message.ts

import type {
  MessageEntity as Message,
  MessageParticipantEntity as MessageParticipant,
  OrganizationEntity as Organization,
  ParticipantEntity as Participant,
  ThreadEntity as Thread,
} from '@auxx/database/types'

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

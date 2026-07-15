// packages/lib/src/workflow-engine/types/message.ts

import type {
  MessageEntity as Message,
  MessageParticipantEntity as MessageParticipant,
  OrganizationEntity as Organization,
  ParticipantEntity as Participant,
  ThreadEntity as Thread,
} from '@auxx/database/types'

/**
 * A `MessageParticipant` join row hydrated with its `Participant` (identifier,
 * name, ...) — lets trigger-node processors derive `message.to`/`cc`/`bcc`
 * output variables without a second query.
 */
export interface ProcessedMessageParticipant extends MessageParticipant {
  participant?: Participant
}

/**
 * ProcessedMessage extends Message with all necessary relations
 * for workflow execution context
 */
export interface ProcessedMessage extends Message {
  participants: ProcessedMessageParticipant[]
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

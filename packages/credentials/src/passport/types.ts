// packages/credentials/src/passport/types.ts

/**
 * Access mode for shared workflows
 */
export type WorkflowShareAccessMode = 'public' | 'organization' | 'api_key'

/**
 * Passport scope discriminator
 */
export type PassportScope = 'workflow' | 'chat'

/**
 * Fields present on every passport, regardless of scope
 */
export interface BasePassportPayload {
  /** Subject id — endUserId for workflow, visitor Participant.id for chat */
  sub: string
  /** Issuer */
  iss: 'auxx'
  /** Scope discriminator */
  scope: PassportScope
  iat: number
  exp: number
}

/**
 * Workflow passport JWT payload
 */
export interface WorkflowPassportPayload extends BasePassportPayload {
  scope: 'workflow'
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: WorkflowShareAccessMode
  /** Auxx user ID (if logged in) */
  userId?: string
  /** External user ID (for embedded) */
  externalId?: string
}

/**
 * Chat passport JWT payload
 */
export interface ChatPassportPayload extends BasePassportPayload {
  scope: 'chat'
  /** Chat integration / channel id */
  channelId: string
  organizationId: string
  /** Visitor session id (cookie) */
  sessionId: string
}

export type PassportPayload = WorkflowPassportPayload | ChatPassportPayload

/**
 * Options for issuing a workflow passport
 */
export interface IssueWorkflowPassportOptions {
  endUserId: string
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: WorkflowShareAccessMode
  userId?: string | null
  externalId?: string | null
  expiresIn?: string
}

/**
 * Options for issuing a chat passport
 */
export interface IssueChatPassportOptions {
  visitorParticipantId: string
  channelId: string
  organizationId: string
  sessionId: string
  expiresIn?: string
}

/**
 * Result of passport issuance
 */
export interface PassportIssuanceResult<TPayload extends BasePassportPayload> {
  token: string
  expiresIn: string
  payload: Omit<TPayload, 'iat' | 'exp'>
}

export type WorkflowPassportResult = PassportIssuanceResult<WorkflowPassportPayload>
export type ChatPassportResult = PassportIssuanceResult<ChatPassportPayload>

/**
 * Verified workflow passport claims
 */
export interface VerifiedWorkflowPassport {
  endUserId: string
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: string
  userId?: string
  externalId?: string
}

/**
 * Verified chat passport claims
 */
export interface VerifiedChatPassport {
  visitorParticipantId: string
  channelId: string
  organizationId: string
  sessionId: string
}

/**
 * @deprecated Use VerifiedWorkflowPassport directly. Kept as an alias for one phase.
 */
export type VerifiedPassport = VerifiedWorkflowPassport

/**
 * Passport error types
 */
export type PassportError =
  | { code: 'INVALID_PASSPORT'; message: string }
  | { code: 'PASSPORT_EXPIRED'; message: string }

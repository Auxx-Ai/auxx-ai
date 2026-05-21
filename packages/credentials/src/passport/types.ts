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
 * Visitor identity claimed via `window.AuxxChat.identify(...)`.
 *
 * v1: unsigned — the passport stores the claim but does not promote it to a
 * trusted identity. A future phase adds HMAC signing (`source: 'verified'`).
 */
export interface ChatIdentifyClaim {
  name?: string
  email?: string
  externalId?: string
  /** Where the claim came from. v1 only emits 'embedder'. */
  source: 'embedder'
  /** ISO timestamp captured when the embedder called identify(). */
  capturedAt: string
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
  /** Optional claimed visitor identity from the embedder (unsigned in v1). */
  identify?: ChatIdentifyClaim
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
  /** Optional claimed visitor identity from the embedder (unsigned in v1). */
  identify?: ChatIdentifyClaim
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
  /** Optional claimed visitor identity from the embedder (unsigned in v1). */
  identify?: ChatIdentifyClaim
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

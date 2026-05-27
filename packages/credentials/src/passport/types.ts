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
  /**
   * `true` when the mint request carried a validly-signed customer JWT (v4
   * phase 3). Downstream code uses this to decide whether to trust the
   * resolved Contact for attribution or treat it as a soft hint only.
   */
  identityVerified?: boolean
  /** Resolved Contact `EntityInstance.id` when `identityVerified` is true. */
  contactId?: string
  /**
   * SHA-256 of the user JWT used at mint time. Per-request middleware
   * compares against the same hash of the request-bound JWT so a stolen
   * passport without a fresh signed JWT is rejected once enforcement
   * (phase 5) is on.
   */
  userJwtHash?: string
  /**
   * Channel's per-mint enforcement state (v4 phase 5). Baked into the
   * passport so the per-request middleware can decide whether to 401 on a
   * missing/invalid JWT without an extra DB roundtrip. Defaults to `'off'`
   * for backcompat with pre-phase-5 passports.
   */
  identityVerification?: 'off' | 'in_progress' | 'enforced'
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
  /** Set when the mint request carried a validly-signed customer JWT (v4 phase 3). */
  identityVerified?: boolean
  contactId?: string
  userJwtHash?: string
  /** Channel-level enforcement state baked into the passport (v4 phase 5). */
  identityVerification?: 'off' | 'in_progress' | 'enforced'
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
  /** v4 phase 3: present when minted with a valid customer JWT. */
  identityVerified?: boolean
  contactId?: string
  userJwtHash?: string
  /** Channel enforcement state baked at mint time (v4 phase 5). */
  identityVerification?: 'off' | 'in_progress' | 'enforced'
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

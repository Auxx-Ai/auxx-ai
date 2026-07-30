// packages/lib/src/approval-requests/types.ts

import type { ApprovalRequestEntity, Database } from '@auxx/database'
import type { AccessLens, AccessRefusalReason, AccessTargetKind, ApprovalKind } from './client'

export type { ApprovalRequestEntity }

/** The assignee columns of an `ApprovalRequest`, plus the org they live in. */
export interface ApprovalAudience {
  assigneeUsers: string[]
  assigneeGroups: string[]
  organizationId: string
}

/** Outcome of {@link import('./approval-request-mutations').resolveApprovalRequest}. */
export interface ApprovalResponseResult {
  success: boolean
  message: string
  nextPath?: string
}

/**
 * One approval `kind`'s side effect, invoked INSIDE the winning decision claim
 * (plan 28 §5, plan 42 §4.1).
 *
 * Making this a handler rather than a hand-written `if` is what makes
 * {@link ApprovalKindHandler.allowsTokenResolution} a *property of the kind*: a
 * future third kind cannot forget to opt out of the unauthenticated
 * approve-by-email lane the way a forgotten `if` branch would (plan 28 H5).
 */
export interface ApprovalKindHandler {
  kind: ApprovalKind
  /**
   * Whether the UNAUTHENTICATED email-token lane may resolve this kind
   * (plan 28 H5). `true` only for `workflow`: token approve/deny is correct for a
   * human-confirmation node and an escalation hole for a permission grant.
   */
  allowsTokenResolution: boolean
  /**
   * Called inside the resolve transaction, after the winning status claim and the
   * `ApprovalResponse` row. Throwing rolls the whole decision back — which is how
   * an access request refuses a stale approver without leaving a half-applied
   * terminal status behind.
   *
   * `afterCommit` is invoked by the resolve path once the transaction has
   * COMMITTED (module guide §8). Notifications and any cache/realtime fan-out
   * belong there: a mid-transaction bust repopulates from a snapshot the commit
   * has not reached, and a mid-transaction notification survives a rollback.
   */
  /**
   * `afterCommit` receives the NON-transactional `db`, deliberately. It runs
   * after the decision transaction has committed, at which point `ctx.tx` is a
   * released handle — using it throws, and the resolve path only warns on that
   * failure, so a closure over `tx` makes post-commit work (the requester's
   * decided-notification, deferred cache emits) fail SILENTLY.
   */
  onResolved(
    ctx: ApprovalResolveContext
  ): Promise<{ message: string; afterCommit?: (db: Database) => Promise<void> }>
}

/** What a kind handler is given when a decision is claimed. */
export interface ApprovalResolveContext {
  /** The transaction the claim happened in — every side effect must use it. */
  tx: unknown
  /** The row AS CLAIMED, i.e. already carrying its terminal status. */
  request: ApprovalRequestEntity
  /** The acting approver. Authority is revalidated against this, not the snapshot. */
  approverUserId: string
  action: 'approve' | 'deny'
  comment?: string
}

/** Input for creating a THREAD access request (plan 42 §2.3 second revision). */
export interface CreateThreadAccessRequestInput {
  /**
   * The thread id — deliberately NOT a caller-supplied `RecordId`.
   *
   * `entityDefinitionId` is persisted and inherits the mail keyspace hazard
   * #1388 fixed: a CUID-keyed RecordId would store a def id mail visibility never
   * reads. Taking the raw id and minting `toRecordId('thread', id)` server-side
   * makes the slug keyspace a TYPE-LEVEL guarantee — there is no CUID-keyed input
   * to canonicalize, and no third copy of `canonicalMailRecordId`.
   */
  threadId: string
  /** Optional note. Disclosed behind a button in the UI, so most requests carry none. */
  message?: string
}

/** What creating (or re-raising) a thread access request produced. */
export interface CreateAccessRequestResult {
  requestId: string
  /** `true` when an existing pending row was re-notified instead of inserted (§4.5). */
  reRequested: boolean
  /** The user ids snapshotted into `assigneeUsers`. */
  approverUserIds: string[]
}

/**
 * Server-authoritative answer to "can this member ask for this thread, and who
 * would decide it?" (plan 42 §6.2/§6.3). The client checks are presentation only;
 * creation repeats every one of these before it inserts.
 */
export interface AccessRequestPreflight {
  eligible: boolean
  /** The requester's CURRENT composed lens on the thread. */
  currentLens: AccessLens | 'none'
  /** An existing pending request of theirs, if any — drives the pending trigger state. */
  pending: { id: string; createdAt: Date; remindedAt: string | null } | null
  /**
   * Safe display names for the PRIMARY notification recipients. A cache read
   * (`getCachedMembersByUserIds`), never a `User` join — naming the approver is
   * the difference between "sent into the void" and "Sarah will see this".
   */
  approvers: Array<{ userId: string; name: string | null; image: string | null }>
  /** Populated iff `eligible === false`. */
  refusalReason: AccessRefusalReason | null
}

/** Resolved approval audience for one thread (plan 42 §3). */
export interface ThreadApproverResolution {
  /** Every user id snapshotted into `assigneeUsers` — primaries plus owner recovery. */
  userIds: string[]
  /**
   * The subset to actually NOTIFY: inbox Managers when any exist, else org admins.
   * Owners are added to `userIds` as silent recovery approvers precisely so they
   * do not land in every Manager-owned request's notification stream.
   */
  primaryUserIds: string[]
  /** Whether rule 1 (inbox Managers) produced anyone. */
  hasManagers: boolean
}

/** The org-scoped thread facts every mail authority read needs (plan 42 §3). */
export interface ThreadAuthorityContext {
  threadId: string
  /** Raw `Thread.inboxId`, or `null` for a triage thread that belongs to no inbox. */
  inboxId: string | null
  assigneeId: string | null
  primaryEntityInstanceId: string | null
  subject: string | null
  messageCount: number
  participantCount: number
}

export type { AccessLens, AccessRefusalReason, AccessTargetKind, ApprovalKind }

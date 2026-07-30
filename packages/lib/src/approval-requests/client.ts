// packages/lib/src/approval-requests/client.ts
//
// Client-safe types and constants for the approval-request spine (both kinds).
//
// **No `'use client'` directive.** Server code imports this file too, and the
// directive turns every export into a client-reference proxy there
// (`project_use_client_directive_lib_server_import`). Nothing here may import a
// server-only module — keep it to string unions, literals and pure functions.

/** Which lane an `ApprovalRequest` row belongs to. */
export const APPROVAL_KINDS = ['workflow', 'access'] as const
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]

/** What an `access`-kind request targets. */
export const ACCESS_TARGET_KINDS = ['area', 'def', 'instance'] as const
export type AccessTargetKind = (typeof ACCESS_TARGET_KINDS)[number]

/**
 * Mail visibility lens carried on a thread access request. Mirrors
 * `resource-access`'s `GrantLens` as a literal union so this module stays
 * client-safe (that type lives beside server-only Drizzle imports).
 */
export type AccessLens = 'metadata' | 'subject' | 'full'

/**
 * Lifetime of an access request. Required by plan 28 H2 — `cleanupExpiredApprovals`
 * already sweeps `expiresAt`, and the null-expiry reading in
 * `approval-request-queries.ts` is defence in depth rather than the mechanism.
 */
export const ACCESS_REQUEST_EXPIRY_DAYS = 14

/**
 * How long a DENIED `(requester, target)` pair is blocked from re-asking
 * (plan 28 §4.5). Without it the deny button does not actually stop anything —
 * and with a one-click, picker-less trigger (plan 42 §0.2) every re-click is
 * byte-identical, so this is load-bearing rather than hygiene.
 */
export const ACCESS_DENY_COOLDOWN_DAYS = 7

/**
 * Why a thread access request cannot be honoured (plan 42 §5.3).
 *
 * There is deliberately no `plan` case: a `full`-lens thread grant trips neither
 * arm of `assertMailSharingFeature`, so thread requests are honourable on EVERY
 * plan. That is the concrete payoff of hardcoding the lens (§5.2).
 */
export type AccessRefusalReason =
  /**
   * The requester's seat cannot hold the mail front door at all. `Area.inboxes`
   * is absent from `WORKER_AREAS`, and the seat ceiling clamps LAST — so no
   * permission change lifts this. Name the seat, not the profile: pointing an
   * approver at a lever they cannot pull is worse than naming none.
   */
  | 'worker_seat'
  /** `inboxes.view` is closed by the requester's profile and no inbox grant derives it. */
  | 'front_door_closed'
  /** The requester already has `full` on this thread — nothing to ask for. */
  | 'already_full'
  /** A deny on this exact target is still inside its cooldown window. */
  | 'deny_cooldown'
  /** The thread does not exist in this org, or is invisible to the requester. */
  | 'target_unavailable'

/** Human-facing copy for each refusal, keyed so the UI never re-derives it. */
export const ACCESS_REFUSAL_COPY: Record<AccessRefusalReason, string> = {
  worker_seat:
    'Field seats do not include mailbox access. This needs a full seat, not a permission change.',
  front_door_closed:
    'Your permission profile has Inboxes turned off, so conversation access cannot be granted yet.',
  already_full: 'You already have full access to this conversation.',
  deny_cooldown: 'This request was recently declined. You can ask again later.',
  target_unavailable: 'This conversation is no longer available.',
}

/**
 * `ApprovalRequest.metadata` for an `access` row. Stored as jsonb, so treat every
 * field as optional on read — an older row predates any field added later.
 */
export interface AccessRequestMetadata {
  /** Bumped each time a re-request re-notifies instead of inserting (§4.5). */
  remindedAt?: string
  /** How many times the requester has re-asked. */
  remindCount?: number
  /** ISO timestamp of the most recent deny, for the cooldown window. */
  deniedAt?: string
  /** Who decided it, for the requester's history row. */
  decidedById?: string
  /** Why an approve was recorded as `superseded` rather than granting again. */
  supersededReason?: 'already_full'
}

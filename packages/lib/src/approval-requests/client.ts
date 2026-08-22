// packages/lib/src/approval-requests/client.ts
//
// Client-safe types and constants for the approval-request spine (both kinds).
//
// **No `'use client'` directive.** Server code imports this file too, and the
// directive turns every export into a client-reference proxy there
// (`project_use_client_directive_lib_server_import`). Nothing here may import a
// server-only module — keep it to string unions, literals and pure functions.

/**
 * Which lane an `ApprovalRequest` row belongs to.
 *
 * - `workflow` — the human-confirmation node inside a run.
 * - `access` — a member asking for permission.
 * - `bulk-dispatch` — a large sync run's held workflow dispatches awaiting
 *   review (plan events/03 §9, D-19): one request per HELD workflow per run.
 */
export const APPROVAL_KINDS = ['workflow', 'access', 'bulk-dispatch'] as const
export type ApprovalKind = (typeof APPROVAL_KINDS)[number]

/**
 * ── THE APPROVAL OUTCOME VOCABULARY, DEFINED ONCE ───────────────────────────
 *
 * Two vocabularies exist and they are NOT interchangeable:
 *
 * - **`ApprovalAction`** (`'approve' | 'deny'`, `@auxx/database/enums`) — the
 *   imperative verb a reviewer performs. It is the API input and the
 *   `ApprovalResponse.action` column. Nothing else.
 * - **`ApprovalOutcome`** (here) — the past-tense state a request ENDED in, and
 *   the only vocabulary allowed downstream of a decision: the resume payload's
 *   `outcome`, the human-confirmation node's branch handles, and its `outcome`
 *   workflow variable.
 *
 * The outcomes are the terminal `ApprovalStatusValues` a workflow can route on,
 * and they are already the names of the node's three canvas handles
 * (`nodes/core/human/node.tsx`) and of the `ApprovalRequest.status` a decision
 * writes. Producers converge on them via {@link outcomeForAction}; consumers
 * must never re-spell them.
 *
 * `withdrawn` and `superseded` are terminal too but are access-lane statuses
 * with no workflow branch, so they are deliberately not outcomes — an
 * administratively cancelled workflow request routes as `denied` (it will never
 * be approved) while its row goes to `withdrawn`.
 */
export const APPROVAL_OUTCOMES = ['approved', 'denied', 'timeout'] as const
export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number]

/** The outcome a reviewer's verb produces. The ONLY action→outcome mapping. */
export function outcomeForAction(action: 'approve' | 'deny'): ApprovalOutcome {
  return action === 'approve' ? 'approved' : 'denied'
}

/** Whether an unknown value is one of the three routable outcomes. */
export function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return typeof value === 'string' && (APPROVAL_OUTCOMES as readonly string[]).includes(value)
}

/** What an `access`-kind request targets. */
export const ACCESS_TARGET_KINDS = ['area', 'def', 'instance'] as const
export type AccessTargetKind = (typeof ACCESS_TARGET_KINDS)[number]

/**
 * Mail visibility lens carried on a thread access request — the grantable
 * subset of the shared rung ladder (`Exclude<Lens, 'none'>`), spelled as a
 * literal union so this module stays client-safe and dependency-free.
 *
 * Renamed with the ladder in plan v3/03 P3b (`subject`→`identity`,
 * `full`→`read`); migration 0319 rewrites the stored `ApprovalRequest`
 * values alongside `ResourceAccess`'s.
 */
export type AccessLens = 'metadata' | 'identity' | 'read'

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
 * Why an instance access request cannot be honoured (plan 42 §5.3, extended by
 * plan v3/04 §4).
 *
 * **Not every reason applies to every lane, and that is the point** — the union
 * is shared so the two lanes cannot invent overlapping vocabularies, but which
 * members a lane can actually produce is narrowed at the lane
 * ({@link RecordAccessRefusalReason}).
 */
export type AccessRefusalReason =
  /**
   * The requester's seat cannot hold the target's front door at all.
   *
   * MAIL: `Area.inboxes` is absent from `WORKER_AREAS`. RECORDS: `Area.records`
   * is absent from the same set, so `recordAccessAt` returns `'none'`
   * unconditionally — checked ABOVE any row branch, so no share can lift it
   * either. Both are clamped LAST, so no permission change helps: name the seat,
   * not the profile. Pointing an approver at a lever they cannot pull is worse
   * than naming none.
   */
  | 'worker_seat'
  /**
   * `inboxes.view` is closed by the requester's profile and no inbox grant
   * derives it.
   *
   * **MAIL ONLY.** A record grant at `read` or better populates `grantedDefIds`
   * itself (`computeGrantedDefIds`), which is exactly what `RecordRouteGuard`
   * gates on — there is no separate key for a record request to be missing
   * (plan v3/04 §4). Do not port this reason into the record lane.
   */
  | 'front_door_closed'
  /** MAIL: the requester already has `full` on this thread — nothing to ask for. */
  | 'already_full'
  /**
   * RECORDS: the requester is already at the top of what this lane can ask for.
   *
   * Fires at `edit`, NOT at the top of the ladder: `admin` is deliberately
   * unrequestable (§3.2), so a member holding `edit` — or `admin` — has nothing
   * left to ask for. The mail twin is {@link AccessRefusalReason} `already_full`;
   * they are separate members because they fire at different rungs and read
   * differently to a user.
   */
  | 'already_at_ceiling'
  /** A deny on this exact target is still inside its cooldown window. */
  | 'deny_cooldown'
  /** The target does not exist in this org, or is invisible to the requester. */
  | 'target_unavailable'
  /**
   * RECORDS: the org's plan does not include `granularPermissions`, so an
   * approved request could not write the grant it promises (§3.5).
   *
   * Mail has no such case — a `read` thread grant trips neither arm of
   * `assertMailSharingFeature`, which is the concrete payoff of hardcoding the
   * thread lens (plan 42 §5.2). Records have no exemption, so the gate is real
   * and is applied at BOTH creation and the decision handler.
   */
  | 'plan_gated'

/** Human-facing copy for each refusal, keyed so the UI never re-derives it. */
export const ACCESS_REFUSAL_COPY: Record<AccessRefusalReason, string> = {
  worker_seat:
    'Field seats do not include mailbox access. This needs a full seat, not a permission change.',
  front_door_closed:
    'Your permission profile has Inboxes turned off, so conversation access cannot be granted yet.',
  already_full: 'You already have full access to this conversation.',
  already_at_ceiling: 'You already have edit access to this record.',
  deny_cooldown: 'This request was recently declined. You can ask again later.',
  target_unavailable: 'This conversation is no longer available.',
  plan_gated: 'Record sharing is not available on your plan.',
}

/**
 * The subset of {@link AccessRefusalReason} the RECORD lane can produce
 * (plan v3/04 §4).
 *
 * Spelled as a narrowing rather than a second union so the two lanes cannot
 * drift into overlapping vocabularies — and so `front_door_closed` /
 * `already_full` are a COMPILE error in record code rather than a plausible
 * copy-paste.
 */
export type RecordAccessRefusalReason = Exclude<
  AccessRefusalReason,
  'front_door_closed' | 'already_full'
>

/**
 * Record-lane copy. Deliberately a second table rather than a per-key override:
 * every string here names a RECORD, and a partial override map is how one of
 * them ends up saying "conversation" six months from now.
 */
export const RECORD_ACCESS_REFUSAL_COPY: Record<RecordAccessRefusalReason, string> = {
  worker_seat:
    'Field seats do not include record access. This needs a full seat, not a permission change.',
  already_at_ceiling: 'You already have edit access to this record.',
  deny_cooldown: 'This request was recently declined. You can ask again later.',
  target_unavailable: 'This record is no longer available.',
  // Names the PLAN, never the profile: this is not a permission problem, and
  // telling someone to ask an admin for permission wastes their time (§4).
  plan_gated: 'Record sharing is not available on your plan.',
}

/**
 * Which record refusals the popover SPEAKS, mirroring mail's `SPOKEN_REFUSALS`
 * (§4).
 *
 * The rest stay silent because the client has already hidden the trigger for
 * them — `already_at_ceiling` is decidable from the `_access` stamp and
 * `target_unavailable` means there is nothing to render against — and explaining
 * a control the user cannot see is noise.
 */
export const SPOKEN_RECORD_REFUSALS: readonly RecordAccessRefusalReason[] = [
  'worker_seat',
  'deny_cooldown',
  'plan_gated',
]

/**
 * `ApprovalRequest.metadata` for a `bulk-dispatch` row — the pointer to the run
 * whose `heldDispatches` entry this request decides (plan events/03 D-19).
 *
 * Deliberately metadata, not columns: the target is a run-row jsonb entry, not
 * a FK-able row, and the `workflowId` column's `onDelete: 'restrict'` would
 * couple workflow deletion to an unrelated pending sync review. The
 * authoritative record set lives on the RUN ROW's matching entry — this
 * metadata only names it.
 */
export interface BulkDispatchRequestMetadata {
  /** Which run table `ref` points into. */
  source: 'connector' | 'import'
  /** `DataConnectorRun.id` (connector) or `ImportJob.id` (import). */
  ref: string
  /** The held workflow — matches `heldDispatches[].workflowId` on the run row. */
  workflowId: string
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
  /**
   * Why an approve was recorded as `superseded` rather than granting again —
   * `already_full` from the thread lane, `already_at_ceiling` from the record
   * lane. Both mean "access arrived another way between filing and the
   * decision"; they differ only in which ladder said so.
   */
  supersededReason?: 'already_full' | 'already_at_ceiling'
}

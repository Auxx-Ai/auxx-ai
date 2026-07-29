// packages/lib/src/permissions/visibility/context.ts

import type { OrganizationRole } from '@auxx/database'
import type { Lens } from './lens'

/**
 * The cached per-user×org visibility context — the single input every mail
 * read path evaluates against. Composed once per invalidation from the cached
 * memberRoleMap + cached inboxes (with defaultLens) + one grantee-expanded
 * ResourceAccess query, then cached in the user-cache tier (§3).
 *
 * All maps are JSON-serializable (plain records, not Sets/Maps) so the cache
 * layer can round-trip them.
 */
export interface UserMailVisibility {
  /** The viewer — the assignee derivation rule compares against this. */
  userId: string
  /** From the cached memberRoleMap. */
  role: OrganizationRole
  /**
   * Org rank (OWNER/ADMIN). **NOT AN AUTHORITY IN THE MAIL PATH** since plan 40
   * phase 2: every `isAdmin` short-circuit in `effective-lens`, `visibility-scope`,
   * `InboxService` and the `inbox` branch of `mail-sharing-guard` was deleted, and
   * admins now read mail through `ResourceAccess` rows + the `Area.inboxes` fallback
   * like everyone else (plan 40 §4.2 — profile is THE control).
   *
   * Retained only as descriptive metadata for surfaces that report rank
   * (`inbox.myLenses`) and for the thread/contact branches of
   * `assertCanManageMailSharing`, which plan 40 §2 keeps out of scope. **Do not
   * reintroduce it as a gate** — use {@link isMailAdmin} if you mean "runs the mail
   * operation", or the inbox floor if you mean "may read this mailbox".
   */
  isAdmin: boolean
  /**
   * `Area.inboxes === Level.Full` — the MAIL-OPERATIONS rung (plan 40 §1.2/§4.4),
   * composed from the member's capability blob, not from their rank.
   *
   * It confers exactly two things and nothing else:
   *  1. a `metadata` floor on OTHERS' personal mailboxes (the "why is nobody
   *     answering this" view, §4.4) — already folded into {@link inboxLens} by
   *     `composeUserMailVisibility`, so no reader needs a branch for it;
   *  2. the residual null-`inboxId` triage threads, which belong to no inbox and
   *     therefore inherit no floor (`visibility-scope.ts`).
   *
   * A default admin holds it (`ROLE_DEFAULTS.ADMIN` is `ALL_FULL`), so §4.4 is
   * behaviour-neutral for them; a member granted `inboxes: Full` gains it, which is
   * correct — that rung IS the mail-operations role.
   */
  isMailAdmin: boolean
  /**
   * Effective lens floor per inbox — max over: the member's positive
   * `ResourceAccess` rows on that inbox, the `Area.inboxes` fallback for a
   * row-less SHARED inbox, and (for a mail admin) `metadata` on others' personal
   * mailboxes. Only entries > `none`.
   *
   * Since plan 40 phase 2 the `inbox_default_lens` FieldValue is NOT an input:
   * migration 060 projected every non-`full` floor onto a `role:org_member` row
   * and the rows are now the sole source (§4.2).
   */
  inboxLens: Record<string, Lens>
  /** Personal inboxes (§11) — cap the admin short-circuit at `metadata`. JSON-serializable set. */
  personalInboxIds: Record<string, true>
  /** Explicit per-thread instance grants (lens each). */
  threadGrants: Record<string, Lens>
  /** Contact instance grants — derive to every thread the contact participates in. */
  contactGrants: Record<string, Lens>
  /** Grants on a thread's primary entity (ticket/deal/…). */
  entityGrants: Record<string, Lens>
}

/**
 * The system principal — full access, no per-inbox scoping. A distinct sentinel
 * (not a `UserMailVisibility` with `isAdmin: true`) so every system-power call
 * site is greppable. Workers / ingest / platform pipelines use this.
 */
export const SYSTEM_VISIBILITY = { kind: 'system' } as const
export type SystemVisibility = typeof SYSTEM_VISIBILITY

/**
 * The configured-automation principal (§8.2): `full` on every org inbox,
 * zero access to personal inboxes (§11) — a System-running workflow must not
 * be a side door around the admin metadata cap. Composed per org from the
 * cached inboxes shape by `getAutomationVisibility`; a distinct kind so every
 * automation call site stays greppable. This is the `mode: 'system'` arm of
 * the recorded future run-as binding.
 */
export interface AutomationVisibility {
  kind: 'automation'
  /** Personal inboxes (§11) — invisible to automation. Empty until Phase 8 stamps them. */
  personalInboxIds: Record<string, true>
}

/** A mail read is always performed by one of these principals. */
export type MailViewer = UserMailVisibility | SystemVisibility | AutomationVisibility

/** Narrow a viewer to the system sentinel. */
export const isSystemViewer = (v: MailViewer): v is SystemVisibility =>
  'kind' in v && v.kind === 'system'

/** Narrow a viewer to the configured-automation principal. */
export const isAutomationViewer = (v: MailViewer): v is AutomationVisibility =>
  'kind' in v && v.kind === 'automation'

/** Narrow a viewer to a real user's cached visibility context. */
export const isUserViewer = (v: MailViewer): v is UserMailVisibility => !('kind' in v)

/**
 * The per-thread facts the evaluator needs. List paths get
 * `participantContactIds` from `ThreadParticipant.entityInstanceId` (§2.4) in
 * the meta batch they already load; merged threads pass the surviving thread.
 */
export interface ThreadVisibilityInput {
  threadId: string
  inboxId: string | null
  assigneeId: string | null
  primaryEntityInstanceId: string | null
  participantContactIds: string[]
}

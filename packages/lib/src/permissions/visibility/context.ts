// packages/lib/src/permissions/visibility/context.ts

import type { Rung } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import type { DefKeyedRungs } from '../../resource-access/instance-grants'
import { isMailSharingDef } from '../../resource-access/mail-sharing-defs'
import { deriveThreadRungFromRecordGrant } from '../capabilities/record-thread-derivation'
import { RUNG_ORDER } from '../capabilities/rung'
import type { Lens } from './lens'

/**
 * The cached per-user×org instance-grant context — the single input every mail
 * read path evaluates against. Composed once per invalidation from the cached
 * memberRoleMap + cached inboxes + ONE grantee-expanded, instance-level
 * ResourceAccess query (`loadUserInstanceGrants`, shared with the capability
 * composer), then cached in the user-cache tier as `user:instance-grants`.
 *
 * **Renamed from `UserMailVisibility` / `user:mail-visibility` by plan v3/03 P4**,
 * together with the reshape below. Plan §4 asserts the four maps "were always
 * `Record<defId, Record<instanceId, rung>>` written longhand"; they were not —
 * they were four FLAT `Record<instanceId, Lens>` maps with the def baked into the
 * FIELD NAME (`threadGrants` / `contactGrants` / `entityGrants`), which is why
 * `entityGrants` could not tell a ticket grant from a deal grant and why a record
 * def and the `contact` mail slug collide in one keyspace
 * (`project_contact_keyspace_collision`). {@link grants} is the real def-keyed
 * shape; the rename is not cosmetic.
 *
 * All maps are JSON-serializable (plain records, not Sets/Maps) so the cache
 * layer can round-trip them.
 */
export interface UserInstanceGrants {
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
   *     `composeUserInstanceGrants`, so no reader needs a branch for it;
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
   * **PRECOMPUTED, and it stays that way** (plan v3/03 §4). Unlike {@link grants}
   * this is not a projection of rows — it is a FOLD over rows, cached inboxes and
   * the member's area level, and moving it into the evaluator re-opens a recorded
   * bug: a mail admin could open a personal thread by id while the SQL list
   * predicate hid it, because `effectiveLens` and `buildMailVisibilityPredicate`
   * would have had to agree on the fold independently. Every reader — the list
   * predicate, `inboxLensFor` (realtime subscribe + `inbox.myLenses`), the sidebar
   * and the counts seed — reads this one map.
   *
   * Since plan 40 phase 2 the `inbox_default_lens` FieldValue is NOT an input:
   * migration 060 projected every non-`read` floor onto a `role:org_member` row
   * and the rows are now the sole source (§4.2).
   */
  inboxLens: Record<string, Lens>
  /** Personal inboxes (§11) — cap the admin short-circuit at `metadata`. JSON-serializable set. */
  personalInboxIds: Record<string, true>
  /**
   * Instance grants keyed **by definition, then by instance** — the reshape plan
   * v3/03 P4 performs (§4).
   *
   * Contains exactly the defs whose grants a thread's lens can derive from:
   * `thread` (the explicit per-thread share), `contact` (derives to every thread
   * the contact participates in), and RECORD-DEFINITION CUIDs (a grant on a
   * thread's primary entity — ticket, deal, …). The inbox defs are absent by
   * construction: their rows are folded into {@link inboxLens} instead, so there
   * is exactly one answer to "what is my lens on this mailbox". The instance-access
   * config resources (dataset, dashboard, snippet, …) are absent too — they belong
   * to the capability blob's lane and would only bloat this one.
   *
   * Values are the STORED {@link Rung}, unclamped. A record def declares
   * `RECORD_DEF_RUNGS`, so an `edit` or `admin` grant on a ticket is legal and
   * lands here verbatim; mail readers clamp with `rungAsLens` at the point of use,
   * and the `Lens` narrowing makes forgetting to do so a compile error rather than
   * a silently widened lens.
   *
   * Entries at `'none'` are never stored — the blob's contract is "only entries
   * above none", and `'none'` is a restriction marker whose absence from a POSITIVE
   * map is the correct encoding (`project_permission_none_is_a_restriction`).
   */
  grants: DefKeyedRungs
  /**
   * `defId → EntityDefinition.entityType` for exactly the defs present in
   * {@link grants} — the **cascade cap's** input (plan v3/03 §13.1, P5).
   *
   * `grants` is keyed by per-org definition CUIDs, and the cap
   * ({@link import('../capabilities/record-thread-derivation').recordThreadDerivationCap})
   * is a code-authored judgement about a def's NATURE, so it can only be keyed
   * by the stable system slug. Without this map
   * {@link primaryEntityThreadRung} walks `grants`, finds a rung and has no way
   * to know which def produced it — which is precisely why the uncapped
   * all-or-nothing fan-out survived as long as it did.
   *
   * Bounded by the number of DEFS the member holds a grant on (typically zero or
   * one), never by grant count — the §4 locality rule.
   *
   * A def missing from this map, or carrying `null` (every custom def), reads as
   * "not ticket-like" and therefore derives NOTHING. That is the fail-closed
   * direction and the intended default.
   */
  defEntityTypes: Record<string, string | null>
}

/** The `thread` def slug — the explicit per-thread share lane. */
export const THREAD_GRANT_DEF = 'thread'
/** The `contact` def slug — grants that derive to every thread the contact is on. */
export const CONTACT_GRANT_DEF = 'contact'

const NO_GRANTS: Readonly<Record<string, Rung>> = Object.freeze({})

/**
 * Explicit per-thread grants, `threadId → rung`.
 *
 * A named accessor rather than a field read, because the def-keyed shape means
 * "which lane" is now a lookup key: spelling `'thread'` at each of the four read
 * sites is how a typo becomes an empty lane that denies silently.
 */
export function threadGrants(v: UserInstanceGrants): Readonly<Record<string, Rung>> {
  return v.grants[THREAD_GRANT_DEF] ?? NO_GRANTS
}

/** Contact grants, `contactInstanceId → rung`. Derive to every thread the contact is on. */
export function contactGrants(v: UserInstanceGrants): Readonly<Record<string, Rung>> {
  return v.grants[CONTACT_GRANT_DEF] ?? NO_GRANTS
}

/** Whether the viewer holds any contact grant — the gate on the ThreadParticipant join. */
export function hasContactGrants(v: UserInstanceGrants): boolean {
  return Object.keys(contactGrants(v)).length > 0
}

/**
 * **The PRIMARY-ENTITY lane, CAPPED** (plan v3/03 §13.1 — the cascade cap,
 * product-decided 2026-07-29): the thread rung a record grant on this instance
 * derives.
 *
 * Every def in {@link UserInstanceGrants.grants} that is not one of the mail
 * sharing slugs is a record definition a thread's `primaryEntityInstanceId` can
 * point at. Walked rather than pre-flattened because callers hold an INSTANCE id
 * and no def (`ThreadVisibilityInput.primaryEntityInstanceId` is a bare CUID),
 * and because the flat map is precisely what the P4 reshape removed. The loop is
 * over DEFS the member holds a grant on — typically zero or one — not over
 * grants.
 *
 * ⚠ **The cap is applied HERE, per def, and that is the whole point.** The
 * previous shape returned `max(rung)` across the matching defs and DISCARDED
 * which def produced it, so the cap was unappliable and every record grant
 * raised the lens on the record's entire email history at whatever rung the
 * grant carried. Folding after the cap (`max(min(rung, cap))`, not
 * `min(max(rung), cap)`) is what stops a generic def's `admin` grant from
 * out-ranking a ticket's capped `read` in the same fold.
 *
 * Returns `'none'` when nothing derives — including the case where the member
 * DOES hold a grant, on a def that derives nothing. "Held a grant" and "derives
 * a thread lens" are now different questions.
 */
export function primaryEntityThreadRung(v: UserInstanceGrants, instanceId: string): Rung {
  let best: Rung = 'none'
  for (const [defId, byInstance] of Object.entries(v.grants)) {
    if (isMailSharingDef(defId)) continue
    const rung = byInstance[instanceId]
    if (!rung) continue
    const derived = deriveThreadRungFromRecordGrant(rung, v.defEntityTypes[defId])
    if (RUNG_ORDER[derived] > RUNG_ORDER[best]) best = derived
  }
  return best
}

/**
 * Primary-entity instance ids whose DERIVED thread rung is at or above `need` —
 * the SQL list predicate's half of {@link primaryEntityThreadRung}.
 *
 * It must apply the same cap, or the list predicate and the per-thread evaluator
 * disagree: a generic def's grant would put the id in the `IN (…)` list while
 * `effectiveLens` resolved `'none'` for it, giving a row the member can list but
 * whose every field is redacted — the exact list-vs-point divergence the
 * precomputed inbox floor exists to prevent, reproduced in the entity lane.
 */
export function primaryEntityThreadIdsAtOrAbove(v: UserInstanceGrants, need: Rung): string[] {
  const ids = new Set<string>()
  for (const [defId, byInstance] of Object.entries(v.grants)) {
    if (isMailSharingDef(defId)) continue
    const entityType = v.defEntityTypes[defId]
    for (const [instanceId, rung] of Object.entries(byInstance)) {
      const derived = deriveThreadRungFromRecordGrant(rung, entityType)
      // `'none'` is never a positive answer, even against `need: 'none'` — a
      // `>=` comparison alone would make an uncapped def's grants list EVERY
      // thread at the bottom tier.
      if (derived !== 'none' && RUNG_ORDER[derived] >= RUNG_ORDER[need]) ids.add(instanceId)
    }
  }
  return [...ids]
}

/**
 * The system principal — full access, no per-inbox scoping. A distinct sentinel
 * (not a `UserInstanceGrants` with `isAdmin: true`) so every system-power call
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
export type MailViewer = UserInstanceGrants | SystemVisibility | AutomationVisibility

/** Narrow a viewer to the system sentinel. */
export const isSystemViewer = (v: MailViewer): v is SystemVisibility =>
  'kind' in v && v.kind === 'system'

/** Narrow a viewer to the configured-automation principal. */
export const isAutomationViewer = (v: MailViewer): v is AutomationVisibility =>
  'kind' in v && v.kind === 'automation'

/** Narrow a viewer to a real user's cached visibility context. */
export const isUserViewer = (v: MailViewer): v is UserInstanceGrants => !('kind' in v)

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

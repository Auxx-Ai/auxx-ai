// packages/lib/src/permissions/visibility/compute-user-instance-grants.ts

import type { Database } from '@auxx/database'
import { BuiltInEntityTypeValues, type Rung } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { resolveResourceAccessGrantees } from '../../resource-access/grantee-resolution'
import type { BucketedInstanceGrants, DefKeyedRungs } from '../../resource-access/instance-grants'
import { grantedDefIds, loadUserInstanceGrants } from '../../resource-access/instance-grants'
import { isInboxDef, isMailSharingDef } from '../../resource-access/mail-sharing-defs'
import { INSTANCE_ACCESS_KEYS } from '../capabilities/instance-access'
import { Area, areaLevelFromKeys, Level } from '../capabilities/registry'
import { maxRung, RUNG_ORDER } from '../capabilities/rung'
import type { UserInstanceGrants } from './context'
import type { Lens } from './lens'
import { rungAsLens } from './lens'

/**
 * Non-mail `ResourceAccess` resource types that can never be a thread's primary
 * entity — dropped from the composed blob so snippet/dashboard/folder shares
 * don't bloat every member's cached grant context.
 *
 * **DERIVED, not hand-maintained (plan 40 §5.4, phase 4).** It used to be the
 * literal `['snippet','folder','workflow','document']`, which had already gone
 * stale — `dataset`, `kb`, `dashboard`, `agent` and `signature` all became
 * shareable resource types after it was written and none of them were added, so
 * a shared dataset had been landing in the primary-entity bucket ever since.
 * Deriving it from the two vocabularies that actually define "this slug names a
 * non-record resource" means the next such key is covered the day it is declared:
 *
 *  - {@link INSTANCE_ACCESS_KEYS} — the instance-access registry, and
 *  - {@link BuiltInEntityTypeValues} — the built-in grant slugs (`folder`,
 *    `document`, …) that are NOT instance-access keys and would otherwise be
 *    dropped by a purely `INSTANCE_ACCESS_KEYS`-derived set.
 *
 * ⚠ **The mail defs are subtracted back out, and that subtraction is
 * load-bearing.** `inbox` and `personal_inbox` are instance-access keys, and
 * `thread`/`contact` are mail sharing defs; if any of them stayed in this set
 * their grants would fall out of the blob and mail visibility would collapse
 * silently — the inbox floor, the per-thread share and the contact-derived lens
 * all read them. Subtracting {@link isMailSharingDef} is what makes the
 * derivation safe regardless of the order the def branches are written in.
 *
 * ⚠ It does NOT subtract record-definition CUIDs, and must not: a grant on a
 * ticket/deal record IS the primary-entity lane, and dropping it would delete the
 * `entity-grant` derivation rule.
 */
const NON_MAIL_BUILTIN_TYPES: ReadonlySet<string> = new Set(
  [...INSTANCE_ACCESS_KEYS, ...BuiltInEntityTypeValues].filter((key) => !isMailSharingDef(key))
)

/**
 * Whether a def's grants belong in the composed blob's def-keyed
 * {@link UserInstanceGrants.grants} map.
 *
 * The inbox defs are excluded because they are not carried as grants at all —
 * they are FOLDED into {@link UserInstanceGrants.inboxLens}, the precomputed
 * floor. Carrying them twice would give two answers to "what is my lens on this
 * mailbox", which is exactly the divergence the precomputed floor exists to end.
 */
function isGrantMapDef(defId: string): boolean {
  return !isInboxDef(defId) && !NON_MAIL_BUILTIN_TYPES.has(defId)
}

/**
 * One lane's lens on an inbox, across BOTH inbox defs (plan 40 §3.4 / 40a §4).
 *
 * Reading both defs is mandatory, not defensive: once data migration 060 moves a
 * personal mailbox onto `personal_inbox` it re-keys that mailbox's grant rows to
 * match, and a reader that only looked at `'inbox'` would leave the owner without
 * their own mailbox — rows still present, nothing thrown, nothing logged.
 *
 * `edit`/`admin` on a mailbox mean "manages the mailbox", and the widest a thread
 * can be seen at is `read` — {@link rungAsLens} is that order-preserving clamp,
 * and it is the whole remainder of the deleted `grantLens` helper.
 */
function inboxLensFromLane(lane: DefKeyedRungs, inboxId: string): Lens {
  let lens: Lens = 'none'
  for (const defId of Object.keys(lane)) {
    if (!isInboxDef(defId)) continue
    const rung = lane[defId]?.[inboxId]
    if (rung) lens = maxRung(lens, rungAsLens(rung))
  }
  return lens
}

/**
 * Pure composition of a user's instance-grant context (plan v3/03 §4) from cached
 * inputs + the member's bucketed instance-level `ResourceAccess` grants. IO lives
 * in {@link computeUserInstanceGrants}; this is the tested core.
 *
 * **Plan 40 phase 2 — the inbox floor comes from ROWS, not from a FieldValue.**
 * The `inbox_default_lens` field is no longer read here at all: migration 060
 * wrote every non-`full` floor as a `role:org_member` row and the rows are now the
 * sole source. Two consequences worth stating, because both are deliberate:
 *
 *  - **Rank is not an input.** There is no `isAdmin` branch. A default admin holds
 *    `inboxes: Full` (`ROLE_DEFAULTS.ADMIN` is `ALL_FULL`), so the area fallback
 *    gives them `read` on every row-less shared inbox — byte-identical to the
 *    short-circuit this replaces. An admin on a custom profile at `inboxes: None`
 *    gets nothing, and an inbox carrying `role:org_member @ none` excludes a
 *    non-granted admin. Both changes are the point (§4.2).
 *  - **The area level is a GATE, never a lens clamp.** It answers one binary
 *    question — "is the mail front door open for this member" — and when open it
 *    contributes the inbox's ORG-WIDE DEFAULT: the authored `role:org_member`
 *    baseline row's lens, or `read` when no baseline is authored. It never lowers
 *    a lens the member's OWN row conferred: a member at `inboxes: Read` holding
 *    an explicit `admin` row still reads that inbox at `read`, and `Read` vs
 *    `Full` is not a confidentiality tier (§1.3 — `Full` means "runs the mail
 *    operation"). Closed front door ⇒ only the member's own rows count, which is
 *    what makes §1.4's "`inboxes: None` means none" true for a row-governed inbox
 *    as well as a row-less one.
 */
export function composeUserInstanceGrants(input: {
  userId: string
  /** From the cached memberRoleMap; undefined when not a member (→ no access). */
  role: OrganizationRole | undefined
  /**
   * The member's `Area.inboxes` level, recovered from their cached capability
   * blob (plan 40 §4.2/§4.4). `Level.None` for a non-member, a closed profile, or
   * a worker seat (`Area.inboxes` ∉ `WORKER_AREAS`, so `SEAT_CEILINGS` strips the
   * keys before they ever reach here).
   */
  inboxesAreaLevel: Level
  /**
   * Cached inboxes shape — id + personal marker (§11) + owner.
   *
   * `isPersonal` is DERIVED by the `inboxes` org-cache provider from the def
   * the instance lives on, OR'd with the legacy `inbox_is_personal` FieldValue
   * (plan 40 §3.4 / `InboxService.derivePersonal`). This composition therefore
   * needs no def branch of its own: the merged list already spans both
   * `inbox` and `personal_inbox`, and re-deriving personal-ness here would
   * open a second source of truth that can drift from the cache's.
   *
   * `defaultLens` is deliberately absent from this shape — see the note above.
   */
  inboxes: Array<{
    id: string
    isPersonal?: boolean
    ownerUserId?: string | null
  }>
  /**
   * The member's instance-level grants, bucketed by `bucketInstanceGrantRows` —
   * **the same value `composeUserCapabilities` composes from** (plan v3/03 §12,
   * P4). One query, one bucketing pass, two blobs.
   */
  instanceGrants: BucketedInstanceGrants
  /**
   * `entityDefinitionId → entityType` over the org's definition catalog — the
   * cascade cap's key resolver (plan v3/03 §13.1). Projected down to the defs
   * that actually appear in the composed `grants` map before it is stored, so
   * the blob stays bounded by the member's grant DEFS rather than by the org's
   * schema size (§4's locality rule).
   *
   * Absent ⇒ every def reads as `null` ⇒ nothing derives onto threads. The
   * fail-closed direction.
   */
  defEntityTypes?: Record<string, string | null>
}): UserInstanceGrants {
  const { userId, role, inboxesAreaLevel, inboxes, instanceGrants } = input
  const isAdmin = role === 'OWNER' || role === 'ADMIN'
  const isMailAdmin = !!role && inboxesAreaLevel === Level.Full
  // The front door (§1.4). `Read` IS full working access to org-shared mail
  // (§1.2), so any open rung contributes the same `read` floor.
  const areaOpen = !!role && inboxesAreaLevel >= Level.Read

  // ── The def-keyed grant map ────────────────────────────────────────────────
  //
  // `defId → instanceId → rung`, with the two lanes MERGED. Mail's per-thread,
  // contact and primary-entity derivations have never distinguished a
  // `role:org_member` thread share from a personal one — a thread granted to the
  // whole workspace is granted to every member of it — so merging preserves
  // behaviour exactly. The inbox defs are the sole exception, and they are handled
  // below where the lane split IS the mechanism.
  //
  // `'none'` never enters: it is the restriction marker, and the blob's contract
  // is "only entries above none". Storing it would leave `{ id: 'none' }` entries
  // every consumer has to remember to filter.
  const grants: DefKeyedRungs = {}
  for (const defId of grantedDefIds(instanceGrants)) {
    if (!isGrantMapDef(defId)) continue
    const merged: Record<string, Rung> = {}
    for (const lane of [instanceGrants.individual, instanceGrants.baseline]) {
      for (const [instanceId, rung] of Object.entries(lane[defId] ?? {})) {
        if (rung === 'none') continue
        const existing = merged[instanceId]
        if (!existing || RUNG_ORDER[rung] > RUNG_ORDER[existing]) merged[instanceId] = rung
      }
    }
    if (Object.keys(merged).length > 0) grants[defId] = merged
  }

  // The cascade cap's key resolver, projected onto EXACTLY the defs present in
  // `grants` (plan v3/03 §13.1). A def absent here — or present with `null`,
  // which is every custom definition — derives nothing onto threads.
  const defEntityTypes: Record<string, string | null> = {}
  for (const defId of Object.keys(grants)) {
    if (isMailSharingDef(defId)) continue
    defEntityTypes[defId] = input.defEntityTypes?.[defId] ?? null
  }

  // ── The inbox floor — PRECOMPUTED, and it must stay that way ───────────────
  //
  // Per-inbox effective floor: max(the member's own rows, the authored workspace
  // baseline or the area fallback, the mail-admin personal `metadata` view). Only
  // entries > none. Non-members get no floor at all — grants alone would be a data
  // bug, but the empty maps fail closed regardless.
  const inboxLens: Record<string, Lens> = {}
  // OTHERS' personal inboxes (§11) — the viewer's own never caps them, so an
  // owner keeps `read` on their own mailbox through their Manager row.
  //
  // One of only TWO producers of a `personalInboxIds` map (the other is
  // `automation-visibility.ts`); everything downstream — `effective-lens`,
  // `thread-lens`, `visibility-scope`, `mail-counts`, `context-to-conditions` —
  // consumes the map and needs no def awareness. Keeping the derivation in the
  // cache (above) rather than here is what makes that hold.
  const personalInboxIds: Record<string, true> = {}
  if (role) {
    for (const inbox of inboxes) {
      const othersPersonal = !!inbox.isPersonal && inbox.ownerUserId !== userId
      if (othersPersonal) personalInboxIds[inbox.id] = true

      // Starts from the viewer's OWN rows only — the INDIVIDUAL lane. These
      // survive a closed front door: plan 25 §2's `INSTANCE_ACCESS_READ_KEYS`
      // synthesises a derived `inboxes: Read` key from exactly such a row, so a
      // member at area `None` who was shared ONE inbox sees exactly that inbox.
      // Gating them would break that positive control.
      let lens = inboxLensFromLane(instanceGrants.individual, inbox.id)
      if (inbox.isPersonal) {
        // A personal mailbox has NO org-wide default: not the area fallback, and
        // not a baseline row either — the BASELINE lane is never consulted here,
        // so a stray `role:org_member` row on one grants nobody anything rather
        // than handing the whole org its owner's private mail. That is the whole
        // reason `personal_inbox` is a second instance-access key with
        // `baselineAtCreate: true` (§0.2). The only floor above an explicit row
        // is §4.4's mail-admin `metadata` view.
        //
        // Composed HERE rather than branched in `effectiveLens` so every reader
        // agrees: the SQL list predicate, `inboxLensFor` (realtime subscribe +
        // the FE `myLenses` read), the inbox sidebar and the counts seed all read
        // `inboxLens`. Leaving it in the evaluator alone would have let a mail
        // admin open a personal thread by id while the list predicate hid it.
        if (othersPersonal && isMailAdmin) lens = maxRung(lens, 'metadata')
      } else if (areaOpen) {
        // ONE gate for the org-wide default, whichever form it takes: an AUTHORED
        // baseline (the inbox is `governing`) contributes that baseline row's
        // lens, and an inbox with no authored baseline contributes `read` — the
        // org-shared default the `Area.inboxes` fallback supplies.
        //
        // `governing` is `isGoverningInstanceRow` over the member's own grantee-
        // expanded rows: a `role:org_member` row at ANY rung, or any `'none'` row.
        // An `identity` baseline and a `none` baseline are both authored
        // statements of "this is the org-wide default", and both must stand the
        // fallback down — otherwise an `identity`-floored inbox would be raised
        // straight back to `read` and the down-tier silently undone.
        //
        // Both halves live behind `areaOpen` deliberately (§1.4 — "`inboxes: None`
        // means none"). The fallback half was always gated; the row half was not,
        // which was inert only while the sole `role:org_member` inbox rows in
        // existence were migration 060's. Plan 40 §6 made the UI author them, so
        // the ungated read would have handed a member at `inboxes: None` the full
        // contents of every inbox an admin had merely down-tiered.
        //
        // An explicit per-member `none` row makes the inbox governing with NO
        // baseline entry, so it contributes `'none'` and the member keeps whatever
        // their own rows gave them (nothing) — the restriction holds.
        lens = maxRung(
          lens,
          instanceGrants.governing[inbox.id]
            ? inboxLensFromLane(instanceGrants.baseline, inbox.id)
            : 'read'
        )
      }

      if (lens !== 'none') inboxLens[inbox.id] = lens
    }
  }

  return {
    userId,
    role: role ?? 'USER',
    isAdmin: role ? isAdmin : false,
    isMailAdmin,
    inboxLens,
    personalInboxIds,
    grants,
    defEntityTypes,
  }
}

/**
 * Compute a user's instance-grant context for one org: cached memberRoleMap
 * + cached inboxes + the member's cached capability blob + cached group
 * memberships + ONE grantee-expanded, instance-level ResourceAccess query.
 *
 * That query is `loadUserInstanceGrants` — **the same one
 * `computeUserCapabilities` runs** (plan v3/03 §11, P4). Before P4 there were two
 * near-identical instance-level compose queries, with two grantee unions and two
 * bucketing loops; the union that survived is the shared one, so a grantee kind
 * cannot reach one blob and not the other.
 *
 * **`userCapabilities` is a hard dependency since plan 40 phase 2** (the area
 * fallback §4.2 + `isMailAdmin` §4.4). `permission-profile.changed` and
 * `permission-grant.changed` therefore invalidate `userInstanceGrants` too
 * (`invalidation-graph.ts`) — without that edge a profile downgrade would leave a
 * stale blob for the full ONE_DAY TTL and the member would keep reading mail
 * their new profile denies. `UserCacheService.invalidateAndRecompute` deletes
 * EVERY key in a batch before recomputing any of them, so the `getUserCache().get`
 * below always read-throughs to a fresh capability blob rather than racing the
 * sibling recompute.
 *
 * Called by the `userInstanceGrants` user-cache provider — read it via
 * `getUserCache().get(userId, 'userInstanceGrants', orgId)`, not directly.
 */
export async function computeUserInstanceGrants(
  userId: string,
  organizationId: string,
  db: Database
): Promise<UserInstanceGrants> {
  // Lazy import to avoid a hard module cycle (cache providers import this file).
  const { getOrgCache, getCachedUserCapabilities } = await import('../../cache')

  const [roleMap, inboxes, grantees, capabilities, resources] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getOrgCache().get(organizationId, 'inboxes'),
    resolveResourceAccessGrantees(organizationId, userId),
    getCachedUserCapabilities(userId, organizationId),
    // The def catalog is already warm for this org on every path that reaches
    // here (`getCapabilities` reads it on the way in), so the cascade cap's key
    // resolver costs no roundtrip.
    getOrgCache().get(organizationId, 'resources'),
  ])

  const instanceGrants = await loadUserInstanceGrants(db, organizationId, grantees)

  const defEntityTypes: Record<string, string | null> = {}
  for (const resource of resources) {
    const defId = (resource as { entityDefinitionId?: string }).entityDefinitionId ?? resource.id
    defEntityTypes[defId] = resource.entityType ?? null
  }

  return composeUserInstanceGrants({
    userId,
    role: roleMap[userId]?.role,
    // `keys` alone — NOT `keys ∪ instanceDerivedKeys`. The derived Read rung is a
    // FRONT-DOOR synthesis for members whose only access is one shared instance;
    // folding it in here would reopen the absent-row fallback and turn "shared one
    // inbox" into "reads every inbox" (the hazard `UserCapabilities.instanceDerivedKeys`
    // documents). Their one inbox already resolves through its own grant row.
    inboxesAreaLevel: areaLevelFromKeys(new Set(capabilities.keys), Area.inboxes),
    inboxes: inboxes.map((i) => ({
      id: i.id,
      isPersonal: i.isPersonal,
      ownerUserId: i.ownerUserId,
    })),
    instanceGrants,
    defEntityTypes,
  })
}

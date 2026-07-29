// packages/lib/src/permissions/visibility/compute-user-mail-visibility.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import {
  BuiltInEntityTypeValues,
  ResourceGranteeType,
  ResourcePermission,
} from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import {
  ORG_MEMBER_GRANTEE_ID,
  resolveResourceAccessGrantees,
  resourceAccessGranteeConditions,
} from '../../resource-access/grantee-resolution'
import { isInboxDef, isMailSharingDef } from '../../resource-access/mail-sharing-defs'
import { INSTANCE_ACCESS_KEYS } from '../capabilities/instance-access'
import { Area, areaLevelFromKeys, Level } from '../capabilities/registry'
import type { UserMailVisibility } from './context'
import { type Lens, maxLens } from './lens'

/** The ResourceAccess columns the visibility composition needs. */
export interface VisibilityGrantRow {
  entityDefinitionId: string
  entityInstanceId: string
  /**
   * Grantee kind + id (plan 40 §4.2). Needed since the floor moved onto rows:
   * a `role:org_member` row IS the inbox's org-wide baseline, so its presence —
   * at ANY permission, including a `view @ subject` down-tier — is what tells
   * the composition "this inbox's default is authored, do not apply the area
   * fallback on top of it".
   */
  granteeType: string
  granteeId: string
  permission: string
  lens: Lens | null
}

/**
 * Non-mail ResourceAccess resource types that can never be a thread's primary
 * entity — excluded from the `entityGrants` bucket so snippet/dashboard/folder
 * shares don't bloat every member's cached mail context.
 *
 * **DERIVED, not hand-maintained (plan 40 §5.4, phase 4).** It used to be the
 * literal `['snippet','folder','workflow','document']`, which had already gone
 * stale — `dataset`, `kb`, `dashboard`, `agent` and `signature` all became
 * shareable resource types after it was written and none of them were added, so
 * a shared dataset has been landing in `entityGrants` ever since. Deriving it
 * from the two vocabularies that actually define "this slug names a non-record
 * resource" means the next such key is covered the day it is declared:
 *
 *  - {@link INSTANCE_ACCESS_KEYS} — the instance-access registry, and
 *  - {@link BuiltInEntityTypeValues} — the built-in grant slugs (`folder`,
 *    `document`, …) that are NOT instance-access keys and would otherwise be
 *    dropped by a purely `INSTANCE_ACCESS_KEYS`-derived set.
 *
 * ⚠ **The mail defs are subtracted back out, and that subtraction is
 * load-bearing.** `inbox` and `personal_inbox` are instance-access keys, and
 * `thread`/`contact` are mail sharing defs; if any of them stayed in this set
 * and the `else if` chain below were ever reordered so they reached this test,
 * their grants would fall out of the mail buckets and mail visibility would
 * collapse silently — the inbox floor, the per-thread share and the
 * contact-derived lens all read those three maps. Subtracting
 * {@link MAIL_SHARING_DEFS} is what makes the derivation safe regardless of
 * branch order.
 */
const NON_MAIL_BUILTIN_TYPES: ReadonlySet<string> = new Set(
  [...INSTANCE_ACCESS_KEYS, ...BuiltInEntityTypeValues].filter((key) => !isMailSharingDef(key))
)

/**
 * Lens conferred by a single grant row: `edit`/`admin` imply `full` (§2.1).
 *
 * `permission: 'none'` confers NOTHING — the v2 restriction marker, and the row
 * data migration 060 writes on a shared inbox whose `inbox_default_lens` is
 * `none` (plan 40 §4.1). It has to be spelled out: the old `!== 'view' ⇒ full`
 * shorthand read that marker as a FULL grant to every org member, so writing the
 * §4.1 floor rows would have handed everyone the restricted inboxes they were
 * written to keep closed — in the phase that is supposed to be inert. Every
 * other reader of this column already skips `none` explicitly
 * (`compose-user-capabilities.ts`, `dashboard-queries.ts`); this one did not.
 */
function grantLens(row: Pick<VisibilityGrantRow, 'permission' | 'lens'>): Lens {
  if (row.permission === 'none') return 'none'
  return row.permission === 'view' ? (row.lens ?? 'full') : 'full'
}

/**
 * Whether a grant row is the inbox's ORG-WIDE BASELINE — `role:org_member`, the
 * marker data migration 060 projects `inbox_default_lens` onto (plan 40 §4.1).
 *
 * Presence, not permission, is what this answers. A `view @ subject` baseline and
 * a `none` baseline are both authored statements of "this is the org-wide default
 * for this inbox", and both must SUPPRESS the {@link Area.inboxes} fallback —
 * otherwise a `subject`-floored inbox would be raised straight back to `full` by
 * the fallback and the down-tier would be silently undone.
 */
function isWorkspaceBaselineRow(row: VisibilityGrantRow): boolean {
  return row.granteeType === ResourceGranteeType.role && row.granteeId === ORG_MEMBER_GRANTEE_ID
}

/**
 * Pure composition of a user's mail-visibility context (§3) from cached
 * inputs + the user's grantee-expanded instance-level ResourceAccess rows.
 * IO lives in {@link computeUserMailVisibility}; this is the tested core.
 *
 * **Plan 40 phase 2 — the floor comes from ROWS, not from a FieldValue.** The
 * `inbox_default_lens` field is no longer read here at all: migration 060 wrote
 * every non-`full` floor as a `role:org_member` row and the rows are now the sole
 * source. Two consequences worth stating, because both are deliberate:
 *
 *  - **Rank is not an input.** There is no `isAdmin` branch. A default admin holds
 *    `inboxes: Full` (`ROLE_DEFAULTS.ADMIN` is `ALL_FULL`), so the area fallback
 *    gives them `full` on every row-less shared inbox — byte-identical to the
 *    short-circuit this replaces. An admin on a custom profile at `inboxes: None`
 *    gets nothing, and an inbox carrying `role:org_member @ none` excludes a
 *    non-granted admin. Both changes are the point (§4.2).
 *  - **The area level is a GATE, never a lens clamp.** It answers one binary
 *    question — "is the mail front door open for this member" — and when open it
 *    contributes the inbox's ORG-WIDE DEFAULT: the authored `role:org_member`
 *    baseline row's lens, or `full` when no baseline is authored. It never lowers
 *    a lens the member's OWN row conferred: a member at `inboxes: Read` holding
 *    an explicit `admin` row still reads that inbox at `full`, and `Read` vs
 *    `Full` is not a confidentiality tier (§1.3 — `Full` means "runs the mail
 *    operation"). Closed front door ⇒ only the member's own rows count, which is
 *    what makes §1.4's "`inboxes: None` means none" true for a row-governed inbox
 *    as well as a row-less one.
 */
export function composeUserMailVisibility(input: {
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
  grants: VisibilityGrantRow[]
}): UserMailVisibility {
  const { userId, role, inboxesAreaLevel, inboxes, grants } = input
  const isAdmin = role === 'OWNER' || role === 'ADMIN'
  const isMailAdmin = !!role && inboxesAreaLevel === Level.Full
  // The front door (§1.4). `Read` IS full working access to org-shared mail
  // (§1.2), so any open rung contributes the same `full` floor.
  const areaOpen = !!role && inboxesAreaLevel >= Level.Read

  // Bucket the grant rows: inbox grants raise that inbox's floor; thread/
  // contact grants derive to threads; everything else that looks like an
  // entity definition becomes a primary-entity grant.
  /**
   * Inbox lens from the viewer's OWN rows — direct `user`, their groups, their
   * bound profile. These survive a closed front door: plan 25 §2's
   * `INSTANCE_ACCESS_READ_KEYS` synthesises a derived `inboxes: Read` key from
   * exactly such a row, so a member at area `None` who was shared ONE inbox sees
   * exactly that inbox. Gating these would break that positive control.
   */
  const inboxGrants: Record<string, Lens> = {}
  /**
   * Inbox lens from the ORG-WIDE BASELINE row (`role:org_member`) — kept apart
   * from the viewer's own rows because it is subject to the front door and they
   * are not.
   *
   * **This separation is load-bearing, and it became load-bearing with plan 40
   * §6.** Before §6 the only `role:org_member` inbox rows in existence were the
   * ones migration 060 wrote, so folding the baseline in with the viewer's own
   * grants was unreachable-wrong. §6 moved floor AUTHORING onto these rows, so
   * any inbox an admin sets to a sub-`full` level now carries one — and a merged
   * bucket would hand its lens to a member whose profile is at `inboxes: None`,
   * inverting §1.4's "**`inboxes: None` means none**". The baseline is the
   * org-wide default for members who are IN the org's mail surface; it is not a
   * grant to someone the profile has shut out.
   */
  const inboxBaseline: Record<string, Lens> = {}
  const threadGrants: Record<string, Lens> = {}
  const contactGrants: Record<string, Lens> = {}
  const entityGrants: Record<string, Lens> = {}
  /** Inboxes whose org-wide default is AUTHORED — the area fallback stands down. */
  const rowGoverned = new Set<string>()

  // `none` rows never enter a grant map: they are restriction markers, tracked
  // through `rowGoverned` instead. Storing them would leave `{ id: 'none' }`
  // entries that every consumer has to remember to filter — the blob's contract
  // is "only entries above none".
  const raise = (map: Record<string, Lens>, key: string, lens: Lens) => {
    if (lens === 'none') return
    map[key] = maxLens(map[key] ?? 'none', lens)
  }

  for (const row of grants) {
    // Drop non-mail resource types FIRST, before any bucketing. Tested ahead of
    // the branches rather than in a trailing `else if` on purpose: that way the
    // "minus the mail defs" half of the derivation above is load-bearing and
    // observable, instead of being masked by the fact that the mail branches
    // happen to be written first. Get the subtraction wrong and the inbox/
    // thread/contact assertions fail immediately, which is the failure this
    // arrangement exists to produce.
    if (NON_MAIL_BUILTIN_TYPES.has(row.entityDefinitionId)) continue

    const lens = grantLens(row)
    // BOTH inbox defs bucket here (plan 40 §3.4 / 40a §4): once migration 060
    // moves personal mailboxes onto `personal_inbox` it re-keys their grant rows
    // to match, and a `personal_inbox` row landing in `entityGrants` below would
    // stop raising the inbox floor — the owner would quietly lose their own
    // mailbox with nothing thrown and nothing logged.
    if (isInboxDef(row.entityDefinitionId)) {
      // A `none` row is the v2 restriction marker at whatever grantee level it
      // was written: as the org-wide baseline it closes the inbox, and as a
      // user/group/profile row it closes it for that member specifically. Either
      // way it stands the fallback down — most-specific-wins, matching
      // `effectiveInstanceLevel`'s "an explicit `'none'` row still denies".
      if (isWorkspaceBaselineRow(row)) {
        rowGoverned.add(row.entityInstanceId)
        raise(inboxBaseline, row.entityInstanceId, lens)
      } else {
        if (row.permission === ResourcePermission.none) rowGoverned.add(row.entityInstanceId)
        raise(inboxGrants, row.entityInstanceId, lens)
      }
    } else if (row.entityDefinitionId === 'thread') raise(threadGrants, row.entityInstanceId, lens)
    else if (row.entityDefinitionId === 'contact') raise(contactGrants, row.entityInstanceId, lens)
    else raise(entityGrants, row.entityInstanceId, lens)
  }

  // Per-inbox effective floor: max(rows, area fallback). Only entries > none.
  // Non-members get no floor at all — grants alone would be a data bug, but
  // the empty maps fail closed regardless.
  const inboxLens: Record<string, Lens> = {}
  // OTHERS' personal inboxes (§11) — the viewer's own never caps them, so an
  // owner keeps `full` on their own mailbox through their Manager row.
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

      // Starts from the viewer's OWN rows only — see `inboxGrants` above.
      let lens = inboxGrants[inbox.id] ?? 'none'
      if (inbox.isPersonal) {
        // A personal mailbox has NO org-wide default: not the area fallback, and
        // not a baseline row either — `inboxBaseline` is never consulted here,
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
        if (othersPersonal && isMailAdmin) lens = maxLens(lens, 'metadata')
      } else if (areaOpen) {
        // ONE gate for the org-wide default, whichever form it takes: an
        // AUTHORED baseline row (`rowGoverned`) contributes that row's lens, and
        // an inbox with no authored baseline contributes `full` — the org-shared
        // default the `Area.inboxes` fallback supplies.
        //
        // Both live behind `areaOpen` deliberately (§1.4 — "`inboxes: None`
        // means none"). The fallback half was always gated; the row half was not,
        // which was inert only while the sole `role:org_member` inbox rows in
        // existence were migration 060's. Plan 40 §6 made the UI author them, so
        // the ungated read would have handed a member at `inboxes: None` the full
        // contents of every inbox an admin had merely down-tiered.
        //
        // An explicit per-member `none` row lands in `rowGoverned` with NO
        // baseline entry, so it contributes `'none'` and the member keeps
        // whatever their own rows gave them (nothing) — the restriction holds.
        lens = maxLens(
          lens,
          rowGoverned.has(inbox.id) ? (inboxBaseline[inbox.id] ?? 'none') : 'full'
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
    threadGrants,
    contactGrants,
    entityGrants,
  }
}

/**
 * Compute a user's mail-visibility context for one org: cached memberRoleMap
 * + cached inboxes + the member's cached capability blob + cached group
 * memberships + ONE grantee-expanded, instance-level ResourceAccess query.
 *
 * **`userCapabilities` is a hard dependency since plan 40 phase 2** (the area
 * fallback §4.2 + `isMailAdmin` §4.4). `permission-profile.changed` and
 * `permission-grant.changed` therefore invalidate `userMailVisibility` too
 * (`invalidation-graph.ts`) — without that edge a profile downgrade would leave a
 * stale mail blob for the full ONE_DAY TTL and the member would keep reading mail
 * their new profile denies. `UserCacheService.invalidateAndRecompute` deletes
 * EVERY key in a batch before recomputing any of them, so the `getUserCache().get`
 * below always read-throughs to a fresh capability blob rather than racing the
 * sibling recompute.
 *
 * Called by the `userMailVisibility` user-cache provider — read it via
 * `getUserCache().get(userId, 'userMailVisibility', orgId)`, not directly.
 */
export async function computeUserMailVisibility(
  userId: string,
  organizationId: string,
  db: Database
): Promise<UserMailVisibility> {
  // Lazy import to avoid a hard module cycle (cache providers import this file).
  const { getOrgCache, getCachedUserCapabilities } = await import('../../cache')

  const [roleMap, inboxes, grantees, capabilities] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getOrgCache().get(organizationId, 'inboxes'),
    resolveResourceAccessGrantees(organizationId, userId),
    getCachedUserCapabilities(userId, organizationId),
  ])

  // Shared grantee union (doc 19 §8.2) — direct user, `role:org_member`, the
  // bound permission profile, and groups. `treatTeamAsGroup` preserves this
  // evaluator's historical matching of legacy `team` rows against group ids.
  //
  // Mail visibility is evaluated through BOTH this forward resolver and the
  // reverse `mailGrantIndex`; the two must enumerate the same grantee kinds or
  // a share is visible in one direction only (19a finding 4).
  const granteeConditions = resourceAccessGranteeConditions(grantees, { treatTeamAsGroup: true })

  const rows = await db
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
      granteeType: schema.ResourceAccess.granteeType,
      granteeId: schema.ResourceAccess.granteeId,
      permission: schema.ResourceAccess.permission,
      lens: schema.ResourceAccess.lens,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        // Instance-level only: type-level grants must NOT derive to threads
        // (April decision — "view all contacts" doesn't expose every thread).
        isNotNull(schema.ResourceAccess.entityInstanceId),
        or(...granteeConditions)
      )
    )

  return composeUserMailVisibility({
    userId,
    role: roleMap[userId]?.role,
    // `keys` alone — NOT `keys ∪ instanceDerivedKeys`. The derived Read rung is a
    // FRONT-DOOR synthesis for members whose only access is one shared instance;
    // folding it in here would reopen the absent-row fallback and turn "shared one
    // inbox" into "reads every inbox" (the hazard `UserCapabilities.instanceDerivedKeys`
    // documents). Their one inbox already resolves through its own grant row below.
    inboxesAreaLevel: areaLevelFromKeys(new Set(capabilities.keys), Area.inboxes),
    inboxes: inboxes.map((i) => ({
      id: i.id,
      isPersonal: i.isPersonal,
      ownerUserId: i.ownerUserId,
    })),
    grants: rows as VisibilityGrantRow[],
  })
}

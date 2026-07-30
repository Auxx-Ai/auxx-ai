// packages/lib/src/cache/user-cache-keys.ts

import type { DehydratedUser } from '../dehydration/types'
import type { UserCapabilities } from '../permissions/capabilities/compose-user-capabilities'
import type { UserInstanceGrants } from '../permissions/visibility/context'
import type { SettingValue } from '../settings/types'

/** Membership info for user cache */
export interface UserMembership {
  id: string
  userId: string
  organizationId: string
  role: string
  status: string
}

/** Mail view for user cache */
export interface CachedMailView {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  isPinned: boolean
  isShared: boolean
  filterGroups: unknown[]
  sortField: string | null
  sortDirection: 'asc' | 'desc' | null
  organizationId: string
  userId: string
  createdAt: string
  updatedAt: string
}

/** Cached table view (JSON-serializable) */
export interface CachedTableView {
  id: string
  tableId: string
  entityDefinitionId: string | null
  name: string
  config: Record<string, unknown>
  contextType: string
  isDefault: boolean
  isShared: boolean
  userId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

/** Cached favorite (JSON-serializable; Date → ISO string) */
export interface CachedFavorite {
  id: string
  organizationMemberId: string
  organizationId: string
  userId: string
  nodeType: 'ITEM' | 'FOLDER'
  title: string | null
  targetType: string | null
  targetIds: Record<string, string> | null
  parentFolderId: string | null
  sortOrder: string
  createdAt: string
  updatedAt: string
}

/** All user-scoped cache keys and their data types */
export interface UserCacheDataMap {
  userProfile: DehydratedUser
  userSettings: Record<string, SettingValue> // keyed by orgId at lookup time
  userMemberships: UserMembership[]
  userMailViews: CachedMailView[]
  userTableViews: CachedTableView[]
  userFavorites: CachedFavorite[]
  userInstanceGrants: UserInstanceGrants
  userCapabilities: UserCapabilities
}

export type UserCacheKeyName = keyof UserCacheDataMap

/** Keys that require orgId as a secondary scope */
export const ORG_SCOPED_USER_KEYS = new Set<UserCacheKeyName>([
  'userSettings',
  'userMailViews',
  'userTableViews',
  'userFavorites',
  'userInstanceGrants',
  'userCapabilities',
])

/**
 * Recompute tiers for `invalidateAndRecompute`'s Phase 2 (plan 45 §1.4).
 *
 * Keys in an EARLIER tier are recomputed before later ones; anything unlisted
 * runs last, concurrently. This exists because user providers read each other:
 * `computeUserInstanceGrants` calls `getCachedUserCapabilities`, so recomputing
 * both concurrently makes the mail provider miss (Phase 1 just deleted the key)
 * and compose the capability blob a SECOND time, racing the explicit recompute.
 * Capability composition is the expensive one in this system.
 *
 * Three things this deliberately is not:
 *
 * - **Not the `INVALIDATION_GRAPH` array order.** `group.deleted` and
 *   `group.members.changed` declare `['userInstanceGrants', 'userCapabilities']`
 *   — the dependent first — and `invalidateAndRecompute`'s docstring already
 *   rejected declared order as a mechanism for the older delete-ordering bug.
 * - **Not a `PromiseMemoizer` on `recompute`.** Memoizing a write-after-write
 *   barrier lets a later invalidation adopt an earlier one's in-flight promise,
 *   which may have read the DB before the later mutation committed — caching a
 *   value that predates its own write for the full TTL. Safe on `get`, unsafe
 *   here.
 * - **Not a correctness mechanism.** Phase 1 deletes everything before Phase 2
 *   recomputes anything, so read-through already guarantees a fresh sibling. This
 *   is purely about not composing it twice.
 */
export const USER_KEY_RECOMPUTE_TIERS: readonly (readonly UserCacheKeyName[])[] = [
  ['userCapabilities'],
  ['userInstanceGrants'],
]

const ONE_DAY = 60 * 60 * 24

/** Key configuration for user-scoped cache */
export const USER_CACHE_KEY_CONFIG: Record<
  UserCacheKeyName,
  { prefix: string; ttlSeconds: number }
> = {
  userProfile: { prefix: 'user:profile', ttlSeconds: ONE_DAY },
  userSettings: { prefix: 'user:settings', ttlSeconds: ONE_DAY },
  userMemberships: { prefix: 'user:memberships', ttlSeconds: ONE_DAY },
  userMailViews: { prefix: 'user:mail-views', ttlSeconds: ONE_DAY },
  // v2 includes entityDefinitionId for effective-Read filtering in tableView.listAll.
  userTableViews: { prefix: 'user:table-views:v2', ttlSeconds: ONE_DAY },
  userFavorites: { prefix: 'user:favorites', ttlSeconds: ONE_DAY },
  // v2: inboxLens values normalized to scalar lenses (cached entries built
  // from the pre-v5 `inboxes` shape carried SINGLE_SELECT arrays).
  // v3: mail floor switched from a FieldValue to ResourceAccess rows (plan 40
  // phase 2). BOTH halves of the bump rule are tripped, which is why it is
  // unconditional rather than a judgement call:
  //   1. SHAPE — the blob gains `isMailAdmin` (§4.4), the `Area.inboxes === Full`
  //      mail-operations flag that replaces `isAdmin` as the key for the personal-
  //      mailbox `metadata` floor.
  //   2. INPUTS — `inboxLens` is now composed from `role:org_member` /user/group/
  //      profile rows plus the `Area.inboxes` fallback, and no longer reads
  //      `inbox_default_lens` at all. A v2 blob was composed from the FieldValue
  //      and carries no memory of which inboxes the migration's rows govern.
  // WHICH WAY A STALE BLOB FAILS — VERIFIED, not asserted, by reading the three
  // consumers rather than reasoning about the writer. A v2 blob deserialized by
  // v3 code has `isMailAdmin === undefined`, and `inboxLens` populated from the
  // OLD floor source:
  //   - `isMailAdmin` is falsy ⇒ `grantScopeParts` omits the null-`inboxId`
  //     triage branch, and no personal-mailbox `metadata` floor is present
  //     (it is composed INTO `inboxLens`, so a v2 blob simply lacks the entry).
  //     Strictly LESS reach. Fail-CLOSED.
  //   - `inboxLens` from `inbox_default_lens`: for the 32-of-34 dev inboxes at
  //     `defaultLens: 'full'` it holds `full`, which is exactly what the v3
  //     fallback computes for an open rung — identical. For a `subject`/`none`
  //     inbox it holds the same or a LOWER lens than v3 would. It cannot hold a
  //     HIGHER one, because migration 060 derives the rows FROM that same field.
  //     Fail-CLOSED.
  // So the stale direction is lost access, not lost restriction — the safe one.
  // The genuinely dangerous stale blob is the CAPABILITIES one (`user:capabilities`
  // below), and that is why `permission-profile.changed` / `permission-grant.changed`
  // gained a `userInstanceGrants` edge in `invalidation-graph.ts` in this same
  // change: without it a profile downgrade leaves a mail blob composed against the
  // OLD area level for the full ONE_DAY TTL, and THAT fails OPEN — the member keeps
  // reading mail their new profile denies. The version bump cannot help there; only
  // the graph edge can.
  // Do NOT re-bump `user:capabilities` (already v14 for this slice) or
  // `org:inboxes` (already v6). `org:mail-grant-index` is deliberately unbumped —
  // migration 060 invalidates it per org instead.
  //
  // v4 (plan v3/03 P3b §3): the VALUE VOCABULARY changed. `Lens` became mail's
  // narrowing of the shared `Rung` ladder, so `'subject'` → `'identity'` and
  // `'full'` → `'read'` in every one of the blob's five lens-valued maps
  // (`inboxLens`, `threadGrants`, `contactGrants`, `entityGrants`, and the lens
  // side of `personalInboxIds`' companions).
  //
  // THE SHAPE DID NOT CHANGE, AND THAT IS THE TRAP. Both before and after, this
  // blob is `Record<string, string>`. "Did the shape change?" is the wrong test
  // (`project_value_vocabulary_cache_bump`); the right one is *can the current
  // parser read a blob the old code wrote* — and it cannot, because `'full'` and
  // `'subject'` are not keys in `RUNG_ORDER`.
  //
  // WHICH WAY A STALE BLOB FAILS — traced through the consumers, not assumed.
  // Every comparator is `RUNG_ORDER[value] >= n`, so an unknown value evaluates
  // `undefined >= n`, which is FALSE for every n:
  //   - `idsAtOrAbove` (`mail-query/visibility-scope.ts`) drops the inbox/thread
  //     id from the list predicate ⇒ the member's mailbox looks EMPTY.
  //   - `effectiveLens` folds with `maxRung`; `RUNG_ORDER['full'] >= RUNG_ORDER[b]`
  //     is false, so the fold keeps `b` ⇒ a `'full'` floor loses to `'none'`.
  //   - `redactThreadMeta` sees `lens !== 'read'` and `!satisfiesRung(lens,
  //     'identity')` ⇒ subject and body blanked for a full viewer.
  //   - `rooms.ts`'s inbox ACL denies the subscribe.
  // All FAIL-CLOSED. The reverse rollout direction is closed too: old code
  // reading a v4 blob computes `ORDER['read']` ⇒ `undefined`, equally false.
  //
  // So the bump is mandatory not because a stale blob leaks, but because both
  // directions are a TOTAL and SILENT loss of mail for the full ONE_DAY TTL —
  // and `vN` is the only thing that stops a draining old instance from
  // repopulating the same keyspace mid-rollout.
  //
  // ⚠ `'none'` and `'metadata'` are spelled the SAME in both vocabularies, so a
  // stale blob is PARTIALLY readable. A smoke test that only exercises a
  // restricted inbox passes. Do not read that as "the bump was optional".
  //
  // ── `user:mail-visibility:v4` → `user:instance-grants:v1` ─────────────────────
  //
  // **v1, not v5, and the reason is the PREFIX, not modesty** (plan v3/03 P4 §12).
  // The version suffix exists to strand blobs written by older code *inside the
  // same keyspace*. Renaming the prefix strands them by construction: no reader of
  // `user:instance-grants:*` can ever encounter a `user:mail-visibility:*` blob,
  // because the key it would have to look up does not exist. Continuing the old
  // counter into a new prefix would advertise a lineage the keyspace does not have.
  // The orphaned `user:mail-visibility:v2..v4` keys are unreachable and expire
  // within the ONE_DAY TTL; the deploy-time flush clears them sooner.
  //
  // WHAT CHANGED, both halves:
  //   1. RENAME. `UserMailVisibility` → `UserInstanceGrants`; the blob is no
  //      longer mail-shaped — it is one member's instance-level grants, of which
  //      mail is (today) the only consumer.
  //   2. RESHAPE, and this is the substantive half. `threadGrants`,
  //      `contactGrants` and `entityGrants` — three FLAT `Record<instanceId,
  //      Lens>` maps with the def baked into the FIELD NAME — collapse into ONE
  //      def-keyed `grants: Record<defId, Record<instanceId, Rung>>`, and the
  //      values are now the STORED rung rather than a lens pre-clamped at compose
  //      time. (Plan §4 claims the maps "were always" def-keyed longhand. They
  //      were not; this is a genuine reshape, which is why it needs a key change
  //      at all.) `inboxLens` and `personalInboxIds` are unchanged — `inboxLens`
  //      is the precomputed floor, not a grant projection, and it stays that way.
  //
  // WHICH WAY A STALE BLOB FAILS — traced, not assumed. In the ordinary case the
  // question is moot: the prefix changed, so a v4 blob is not merely stale, it is
  // UNREACHABLE. The analysis that matters is what happens if the two shapes DO
  // meet — a hand-written key, a restored Redis snapshot, or a future prefix reuse:
  //   - New code reading an OLD-shaped value: `grants` is `undefined`, so
  //     `threadGrants()` / `contactGrants()` return the frozen empty map and
  //     `primaryEntityGrant()` iterates nothing. Every derivation rule except the
  //     inbox floor contributes `'none'`. The member keeps exactly their inbox
  //     floors and their assigned threads, and loses every SHARE.
  //     Fail-CLOSED — lost access, not lost restriction.
  //   - Old code reading a NEW-shaped value: `threadGrants` / `contactGrants` /
  //     `entityGrants` are `undefined`; `idsAtOrAbove(undefined, …)` throws inside
  //     `Object.entries`, so the request 500s rather than resolving permissively.
  //     Loud, and closed.
  //   - `inboxLens` and `personalInboxIds` survive both directions byte-identically,
  //     which is the reason the failure is partial-but-safe rather than total: a
  //     smoke test that only opens a shared inbox passes in BOTH directions. The
  //     same trap the v4 entry above records — do not read a green smoke test as
  //     "the rename was inert".
  //
  // ⚠ ROLLING DEPLOY — what a PREFIX rename means that a version bump does not.
  // During a rollout BOTH prefixes are live at once: new instances read and write
  // `user:instance-grants:v1` while draining old instances keep reading AND
  // WRITING `user:mail-visibility:v4`. The two keyspaces do not observe each
  // other's invalidations — `UserCacheService` deletes by key name, so an
  // invalidation issued by a new instance leaves the old key populated and vice
  // versa. Consequence: a grant changed on a NEW instance is invisible to a
  // request served by an OLD one for up to the ONE_DAY TTL of the old key, and a
  // member could observe access flip back and forth depending on which instance
  // answers. That window is bounded by the drain, and it fails in the "stale
  // grant" direction on the old side only — but it is real, and it is the price of
  // a rename rather than a bump. Run the flush
  // (`packages/lib/scripts/flush-user-capabilities-cache.ts`) AFTER the rollout
  // completes, not before: flushing while old instances still serve traffic just
  // lets them repopulate the abandoned prefix.
  //
  // ── v1 → v2 (plan v3/03 P5 §13.1 — THE CASCADE CAP) ──────────────────────────
  //
  // WHAT CHANGED. `UserInstanceGrants` gains ONE field:
  //
  //     defEntityTypes: Record<defId, string | null>
  //
  // projected onto exactly the defs present in `grants` (bounded by the member's
  // grant DEFS — typically zero or one — never by grant count). Nothing else in
  // the blob moved: `grants`, `inboxLens`, `personalInboxIds` are byte-identical.
  //
  // WHY A FIELD THIS SMALL NEEDS A BUMP AT ALL. It is not the field, it is the
  // BEHAVIOUR it feeds. `grants` is keyed by per-org definition CUIDs, so the two
  // primary-entity readers (`primaryEntityThreadRung`,
  // `primaryEntityThreadIdsAtOrAbove`) could see a rung and had NO way to learn
  // which def produced it — they folded with `max()` and discarded the def. That
  // is why the uncapped fan-out shipped: ANY record grant, on ANY def, at
  // whatever rung it carried, raised the lens on every thread whose
  // `primaryEntityInstanceId` was that record. The cap
  // (`record-thread-derivation.ts`: ticket-like defs derive thread `read`,
  // generic defs derive NOTHING) is keyed by `entityType`, so this map IS the cap.
  //
  // WHICH WAY A STALE BLOB FAILS — traced through both readers, not assumed.
  //   - **New code reading a v1 blob** (`defEntityTypes` absent). Both readers do
  //     `v.defEntityTypes[defId]`, which is a TypeError on `undefined` — so this
  //     direction does NOT silently degrade, it 500s the mail list and the lens
  //     evaluator. Loud, and closed. (It is also why the field is required on the
  //     interface rather than optional: an optional field would have made this
  //     direction resolve to `undefined` → `recordThreadDerivationCap(undefined)`
  //     → `'none'`, i.e. every record-derived thread silently vanishing from
  //     every mailbox for the full ONE_DAY TTL, which is a *worse* failure than a
  //     500 because nobody would notice it was the cache.)
  //   - **Old code reading a v2 blob.** The extra key is ignored by
  //     `primaryEntityGrant`/`primaryEntityIdsAtOrAbove` (the uncapped readers a
  //     draining instance still runs). Result: the old instance keeps applying
  //     the OLD uncapped fan-out — a deal share still lights up that deal's whole
  //     email history — until it drains. Fail-OPEN, and this is the direction
  //     that matters: it is not fixed by the bump, only bounded by the drain. It
  //     is the same exposure that ships in production today, so the rollout does
  //     not make anything worse; it just does not make it better instantly.
  //
  // So unlike the v3→v4 lens-vocabulary bump above, this one is NOT about
  // stranding an unreadable blob — the new shape is a strict superset and the old
  // readers tolerate it. It is about making sure no new-code instance ever reads a
  // blob composed WITHOUT the cap's input, because the only alternative encoding
  // (optional field, absent ⇒ cap everything to `'none'`) fails silently and
  // totally. Run the dev flush after deploying.
  //
  // ⚠ `grants` is unchanged, so a v1 blob is PARTIALLY readable: inbox floors,
  // per-thread shares and contact-derived lenses all resolve correctly from it.
  // A smoke test that never opens a thread hanging off a shared RECORD passes in
  // both directions. Do not read that as "the bump was optional".
  userInstanceGrants: { prefix: 'user:instance-grants:v2', ttlSeconds: ONE_DAY },
  // v2: instance-access slice (#1313) added the `instanceAccess` field + the
  // `datasets` L2 area/keys. Pre-#1313 blobs lack the datasets area entirely, so
  // their expanded key set is missing `datasets.*` (even admins 403 on
  // `datasets.view`). Bump to abandon every stale blob → recompute on next read.
  // v3: KB instance-access slice (doc 12) added the `knowledgeBase` L2 area/keys;
  // pre-slice blobs lack them entirely (admins 403 on `knowledgeBase.view`).
  // v4: dashboards instance-access slice (doc 13) added the `dashboards` L2
  // area/keys; pre-slice blobs lack them entirely (admins 403 on `dashboards.view`).
  // v5: agent capability composition (doc 14 §1) — `userType: 'AGENT'` principals
  // now compose with SET-semantics over an all-Full base instead of the human
  // raise-only model. Pre-slice blobs were composed under the old rule.
  // v6: permission profiles (doc 19 step 2). The human composer's BASE tier
  // changed source — the `role:org_member` org-policy tier was deleted and the
  // bound profile (levels + `baseLevel` + its intrinsic `ceiling`) supplies the
  // base instead. A v5 blob was composed under the old rule, and this key is
  // USER-scoped so an org flush does not reach it: without the bump, members
  // would ride a stale key set for the full ONE_DAY TTL — and a stale blob 403s
  // admins on anything the old composition didn't include.
  // v7: permission-profile DEFINITION ceilings (doc 19 step 4). `UserCapabilities`
  // gained `ceilingDefs` — the bound profile's `{ mode, slugs }` cap, carried raw
  // and slug-keyed so def lifecycle events never have to touch this key. A v6 blob
  // lacks the field entirely, which `effectiveRecordLevel` reads as "uncapped": a
  // member whose profile says `only: [contact]` would keep full record access for
  // the rest of the ONE_DAY TTL. Fail-open on a stale blob is exactly what a
  // ceiling must never do, so the old blobs are abandoned rather than migrated.
  // v8: the DEFINITION ceiling is deleted end-to-end (plan 20 §2.a.2/§2.a.8).
  // `UserCapabilities`/`ClientCapabilities` lose `ceilingDefs`, so every v7 blob is
  // the wrong shape — and the failure direction is the dangerous one: a v7 blob
  // read by the v8 composer has no ceiling, which every remaining seam reads as
  // "uncapped". Fail-OPEN on a stale blob is why this bump ships in the SAME change
  // as the field removal rather than being treated as cosmetic. Abandoned, not
  // migrated — same reasoning as v6→v7 above.
  // v9: `channels` area/key added (plan 21 §6, Tier C residue — mail domains,
  // inboxes, labels, suppression, chat duty, recordings). A stale v8 blob lacks
  // `channelsManage` entirely, which 403s admins on the newly-migrated routers
  // (org cache flush does not reach user capability blobs).
  // v10: member baseline strip (plan 22) — `ROLE_DEFAULTS.USER` went from a
  // generous per-area map to the all-`None` floor; the Member/Field-Tech
  // baseline moved onto a seeded `PermissionGrant` row instead. A stale v9 blob
  // was composed under the old generous fall-through, so it holds keys a
  // member's profile no longer grants — fail-OPEN on a stale blob, the same
  // dangerous direction as v7→v8, so this bump ships in the SAME change as the
  // strip rather than being treated as cosmetic.
  // v11: ONE bump for the whole accumulated instance-access batch, all three
  // parts of which change what a v10 blob contains:
  //   1. `dashboards.edit` (#1344) split the dashboards ladder into
  //      Read/Edit/Full. A v10 blob was expanded against the 2-rung ladder, so
  //      it lacks the key entirely and a Full-level holder cannot edit widgets.
  //   2. `workflows.view` / `workflows.edit` (#1345) split the single-rung
  //      workflows area the same way, and `workflow` joined
  //      `INSTANCE_ACCESS_RESOURCES`.
  //   3. `UserCapabilities` gained `instanceDerivedKeys` (item 5b) — the area
  //      Read rungs synthesized from a member's own instance grants, which is
  //      what makes `can('workflows.view')` true for a member whose only access
  //      is one shared workflow. A v10 blob has no such field, so every coarse
  //      gate (sidebar, cmd+K, the KB/Dashboards landing redirects) would keep
  //      firing against them until the 24h TTL expired.
  // All three fail CLOSED on a stale blob (a missing key denies), so this is a
  // lost-access bump rather than a lost-restriction one — but it is still
  // mandatory: a dev flush is NOT a substitute, because during a rollout a
  // draining old instance repopulates the same keyspace, which is the entire
  // reason `vN` exists.
  // v12: agents instance access (plan 25 §4.2). `Area.agents` split from its
  // single `Full → agents.manage` rung into Read/Edit/Full, and `agent` joined
  // `INSTANCE_ACCESS_RESOURCES` — the same pair of changes `workflow` made in
  // v11's part 2, so the same two staleness effects apply:
  //   1. A v11 blob's `keys` hold `agents.manage` but NOT `agents.view` /
  //      `agents.edit`, because it was expanded against the 1-rung ladder.
  //      `areaLevelFromKeys` walks rungs in order and `break`s at the first
  //      unheld one, so `Area.agents` composes to **None** off a v11 blob, not
  //      to Full — the member loses agents entirely rather than keeping them.
  //   2. A v11 blob carries no `agent` rows in `instanceAccess` or
  //      `instanceDerivedKeys` at all: its instance query ran with `agent`
  //      absent from `INSTANCE_ACCESS_KEYS`, so an explicit grant is invisible
  //      and cannot rescue (1).
  // Both fail CLOSED, so this stays a lost-access bump like v11 — but note the
  // direction is only lucky, not structural. Had `areaLevelFromKeys` taken the
  // highest SATISFIED rung instead of stopping at the first gap, a v11 blob
  // would have read `Full` and handed every member `admin` on every agent
  // (`baselineAtCreate: false` ⇒ the area level IS the absent-row fallback) for
  // the full ONE_DAY TTL, silently voiding every restriction this slice ships.
  // v13: ONE bump covering TWO owed changes — spend it once, name both:
  //   1. signatures + snippets instance access (plan 36 §9). Two new areas
  //      (`signatures`, `snippets`) with three rungs each — six new
  //      `PermissionKey`s, so a v12 blob's `keys` CONTENT is wrong — and
  //      `signature` + `snippet` joined `INSTANCE_ACCESS_RESOURCES`, so the
  //      composed instance shape is wrong too.
  //   2. handoff item 10 phase 3's source attribution, which changes the
  //      `UserCapabilities` shape. Item 10 was already owed a v12 → v13 bump;
  //      this is that bump. Do not spend a second one for it.
  // Which way (1) fails on a stale blob: a v12 blob was composed before any
  // signature/snippet `ResourceAccess` row existed, so `restrictedInstanceIds`
  // lacks every such id → `effectiveInstanceLevel` falls through to
  // `instanceFallbackLevel` → and because both resources are
  // `baselineAtCreate: true`, that returns `undefined` → NO access.
  // Fails CLOSED **by structure, not by luck**: it is the `baselineAtCreate`
  // branch itself doing the denying (`entity-access.ts:412`), not an ordering
  // accident in `areaLevelFromKeys` the way v12's was. Nothing about the rung
  // walk or the order of the checks has to hold for this to stay safe.
  // v14: mail instance access (plan 40 §8). ONE bump covering both halves of the
  // same slice, exactly as v13 did:
  //   1. `Area.inboxes` with two new `PermissionKey`s (`inboxes.view`,
  //      `inboxes.manage`), so a v13 blob's `keys` CONTENT is wrong.
  //   2. `inbox` + `personal_inbox` joined `INSTANCE_ACCESS_RESOURCES`, so the
  //      composed instance shape is wrong too: a v13 blob's instance query ran
  //      with both keys absent from `INSTANCE_ACCESS_KEYS`, so it carries no
  //      inbox rows in `governingInstanceIds` / `instanceAccess` /
  //      `instanceDerivedKeys` at all and an explicit inbox grant is invisible
  //      to it.
  // WHICH WAY A STALE BLOB FAILS — verified against `areaLevelFromKeys`, which
  // walks an area's rungs in ascending order and `break`s at the FIRST unheld
  // rung: a v13 blob holds neither `inboxes.view` nor `inboxes.manage`, so the
  // walk breaks on rung 1 and `Area.inboxes` composes to `None`. With
  // `inbox` at `baselineAtCreate: false` that makes `instanceFallbackLevel`
  // return `undefined` for every row-less shared inbox — i.e. every shared inbox
  // DENIED, and (2) means no explicit row can rescue it either.
  // Fail-CLOSED, but this is the most VISIBLE possible failure: mail goes dark
  // org-wide for up to the ONE_DAY TTL. The deploy-time flush
  // (`packages/lib/scripts/flush-user-capabilities-cache.ts`) is mandatory, not
  // advisory — and note that a flush alone is NOT a substitute for the bump,
  // because a draining old instance repopulates the same keyspace during a
  // rollout, which is the entire reason `vN` exists.
  // The bump itself is INERT on landing: plan 40 phase 1 adds the registry
  // entries only — nothing reads `inboxes.*` or the inbox instance rows until
  // phase 2 switches `composeUserInstanceGrants`'s floor source. `user:mail-
  // visibility` above is deliberately NOT bumped here; that one belongs to
  // phase 2 and must land WITH the blob's shape change, not ahead of it.
  // NOT BUMPED for the 2026-07-29 `governingInstanceIds` slice — recorded so the
  // next reader does not re-litigate it. That change re-semanticized an ORG key
  // (`org:restricted-instance-ids` → `org:governing-instance-ids`, see
  // `org-cache-keys.ts`) and renamed the field on the WIRE snapshot
  // (`ClientCapabilities`), which looks like it should land here — it does not,
  // and the reason is structural rather than a judgement call:
  //   - `UserCapabilities` (the shape THIS key caches — see
  //     `compose-user-capabilities.ts`) is `{ keys, instanceDerivedKeys,
  //     defAccess, instanceAccess }`. It has never carried the instance-governing
  //     set; `getCapabilities` reads that from the ORG cache and passes it to the
  //     `CapabilitySet` constructor separately.
  //   - Not one of those four fields changes meaning, content, or composition.
  //     A v14 blob written by the old code and read by the new (or the reverse)
  //     resolves identically — which is the real bump test, not "did some type
  //     nearby change?".
  //   - `ClientCapabilities` is the wire shape, assembled fresh per request
  //     (`dehydration/service.ts` composes it from `getCapabilities()`; the
  //     `permissions.myCapabilities` refetch recomputes it). It is never stored
  //     in Redis, so the field rename cannot strand a blob.
  // Spending a version here would have cost every user a recompute and bought
  // nothing.
  // NOTE: bump this whenever the registry's area/key set or the UserCapabilities
  // shape changes, so a rollout can't leave members on a stale key set.
  // v15 (plan 41): Area.comments gained a Read rung / comments.view key.
  // A stale v14 blob for a Full member holds comments.manage without the new
  // prerequisite key, so direct reads fail closed while writes may still pass.
  // Bump to keep the ladder coherent across a rolling deploy.
  // v16 (plan 43 §6): the blob changes TWICE OVER, and the two halves fail in
  // OPPOSITE directions — which is the whole reason this entry is long.
  //   1. §3.1 changes `keys` CONTENT. `Area.signatures` / `.snippets` /
  //      `.dashboards` dropped their `Level.Edit` rung, so a stored `Level.Full`
  //      expands to `{view, manage}` where it used to expand to
  //      `{view, edit, manage}`.
  //   2. §4.1 changes the SHAPE. `UserCapabilities` gained a second instance map,
  //      `baselineInstanceAccess`, and `instanceAccess` NARROWED underneath it —
  //      it now carries `user`/`group`/`profile` rows only, where a v15 blob's
  //      carries the max-merged union of those AND `role:org_member`.
  //
  // WHICH WAY EACH FAILS ON A STALE BLOB — the required direction analysis, and
  // the answer differs per cause:
  //
  //   (1) fails SAFE. A stale v15 blob carries the orphan `signaturesEdit` key;
  //   `areaLevelFromKeys` walks the NEW two-rung ladder, finds `signaturesView` +
  //   `signaturesManage`, and composes `Full`. Correct, and the orphan key is
  //   read by nothing. On its own this would be a hygiene bump.
  //
  //   (2) fails **OPEN**, and that is why the bump CANNOT BE DEFERRED. A stale
  //   v15 blob has no `baselineInstanceAccess` at all, so
  //   `caps.baselineInstanceAccess?.[instanceId]` is `undefined` for every
  //   instance — but its `instanceAccess` still holds the merged union of both
  //   lanes. Step 1 of `effectiveInstanceLevel` therefore returns the
  //   `role:org_member` permission AS IF IT WERE AN INDIVIDUAL GRANT, and step
  //   2's area gate never runs. Every member at area `None` keeps every
  //   org-shared dashboard (89 baseline rows in dev) and snippet (28) for the
  //   full ONE_DAY TTL, silently voiding the lever plan 43 exists to ship.
  //
  // The generalizable lesson, recorded because v12's entry below records the
  // opposite mistake: **"the new field is absent so it reads as empty" is
  // FAIL-OPEN whenever the OLD field's meaning also changed underneath it.**
  // An absent field is only safe when the fields around it still mean what they
  // meant; here `instanceAccess` narrowed in the same change, so the absence is
  // not a gap, it is a wrong answer. Same class of accident as v12, whose
  // fail-closed direction was luck rather than structure.
  //
  // v17 (plan v3/03 P3b §3): the VALUE VOCABULARY of the two instance maps
  // changed. `instanceAccess` and `baselineInstanceAccess` carried
  // `ResourcePermission` (`none|view|edit|admin`); they now carry `Rung`
  // (`none|metadata|identity|read|edit|admin`), read verbatim off the new
  // single-column `ResourceAccess.rung`.
  //
  // AS WITH v4 ABOVE, THE SHAPE IS UNCHANGED — `Record<string, string>` before
  // and after — so the "did the shape change?" test says no bump is needed and
  // is wrong. The test that matters is whether the CURRENT parser can read a
  // blob the OLD code wrote.
  //
  // It cannot, and the failure is PARTIAL, which is the sharp edge here: THREE
  // of the four old values (`none`, `edit`, `admin`) are spelled identically in
  // both ladders and keep their exact relative order, so they round-trip
  // perfectly. Only `'view'` is orphaned. A stale v16 blob is therefore mostly
  // correct, and any smoke test that happens to exercise an `admin` creator row
  // — which is every `baselineAtCreate: true` resource's create-time row —
  // passes cleanly while every `view`-tier share is broken.
  //
  // WHICH WAY IT FAILS, traced rather than assumed. `RUNG_ORDER['view']` is
  // `undefined`, so every `satisfiesRung(have, need)` against it is
  // `undefined >= n` ⇒ FALSE:
  //   - `effectiveInstanceLevel` step 1 still RETURNS `'view'` (own-row-first
  //     tests `!== undefined`, not readability), so the resolver short-circuits
  //     with a value no gate accepts: `canViewInstance` /`canEditInstance` /
  //     `canAdminInstance` all deny.
  //   - `instanceListScope`, both arms, push the id into `excludeIds` (open
  //     area) or omit it from `includeIds` (closed area) ⇒ the instance vanishes
  //     from lists too, so list and point-check still AGREE. No empty-page-with-
  //     `hasMore` divergence.
  //   - `instanceDerivedKeys` is stored pre-expanded and its vocabulary did not
  //     change, so the member keeps the coarse front-door key while every
  //     per-instance gate denies: a 403 maze, not a leak.
  // FAIL-CLOSED in every branch, and the reverse rollout direction matches —
  // old code reading a v17 blob computes `PERMISSION_RANK['read']` ⇒
  // `undefined`, equally false.
  //
  // Contrast v16's second cause above, which was fail-OPEN: there, the NEW field
  // was absent AND the old field's meaning had changed underneath it. Here no
  // field is absent and no surviving value changed meaning — one value simply
  // left the vocabulary. That asymmetry is the whole reason the direction has to
  // be traced per bump instead of inherited from the previous entry.
  //
  // Deploy-time flush is mandatory and is NOT a substitute for the bump
  // (`packages/lib/scripts/flush-user-capabilities-cache.ts`): a draining old
  // instance repopulates the same keyspace during a rollout, which is the entire
  // reason `vN` exists.
  userCapabilities: { prefix: 'user:capabilities:v17', ttlSeconds: ONE_DAY },
}

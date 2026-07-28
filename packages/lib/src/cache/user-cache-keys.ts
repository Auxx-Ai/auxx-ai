// packages/lib/src/cache/user-cache-keys.ts

import type { DehydratedUser } from '../dehydration/types'
import type { UserCapabilities } from '../permissions/capabilities/compose-user-capabilities'
import type { UserMailVisibility } from '../permissions/visibility/context'
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
  userMailVisibility: UserMailVisibility
  userCapabilities: UserCapabilities
}

export type UserCacheKeyName = keyof UserCacheDataMap

/** Keys that require orgId as a secondary scope */
export const ORG_SCOPED_USER_KEYS = new Set<UserCacheKeyName>([
  'userSettings',
  'userMailViews',
  'userTableViews',
  'userFavorites',
  'userMailVisibility',
  'userCapabilities',
])

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
  userMailVisibility: { prefix: 'user:mail-visibility:v2', ttlSeconds: ONE_DAY },
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
  // NOTE: bump this whenever the registry's area/key set or the UserCapabilities
  // shape changes, so a rollout can't leave members on a stale key set.
  userCapabilities: { prefix: 'user:capabilities:v12', ttlSeconds: ONE_DAY },
}

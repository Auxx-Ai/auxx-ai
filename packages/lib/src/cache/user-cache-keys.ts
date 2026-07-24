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
  // NOTE: bump this whenever the registry's area/key set or the UserCapabilities
  // shape changes, so a rollout can't leave members on a stale key set.
  userCapabilities: { prefix: 'user:capabilities:v5', ttlSeconds: ONE_DAY },
}

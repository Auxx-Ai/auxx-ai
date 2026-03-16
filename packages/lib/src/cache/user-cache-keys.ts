// packages/lib/src/cache/user-cache-keys.ts

import type { DehydratedUser } from '../dehydration/types'
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

/** All user-scoped cache keys and their data types */
export interface UserCacheDataMap {
  userProfile: DehydratedUser
  userSettings: Record<string, SettingValue> // keyed by orgId at lookup time
  userMemberships: UserMembership[]
  userMailViews: CachedMailView[]
  userTableViews: CachedTableView[]
}

export type UserCacheKeyName = keyof UserCacheDataMap

/** Keys that require orgId as a secondary scope */
export const ORG_SCOPED_USER_KEYS = new Set<UserCacheKeyName>([
  'userSettings',
  'userMailViews',
  'userTableViews',
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
  userTableViews: { prefix: 'user:table-views', ttlSeconds: ONE_DAY },
}

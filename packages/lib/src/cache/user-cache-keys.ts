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

/** All user-scoped cache keys and their data types */
export interface UserCacheDataMap {
  userProfile: DehydratedUser
  userSettings: Record<string, SettingValue> // keyed by orgId at lookup time
  userMemberships: UserMembership[]
  userMailViews: CachedMailView[]
}

export type UserCacheKeyName = keyof UserCacheDataMap

/** Keys that require orgId as a secondary scope */
export const ORG_SCOPED_USER_KEYS = new Set<UserCacheKeyName>(['userSettings', 'userMailViews'])

/** Key configuration for user-scoped cache */
export const USER_CACHE_KEY_CONFIG: Record<
  UserCacheKeyName,
  { prefix: string; ttlSeconds: number }
> = {
  userProfile: { prefix: 'user:profile', ttlSeconds: 600 },
  userSettings: { prefix: 'user:settings', ttlSeconds: 600 },
  userMemberships: { prefix: 'user:memberships', ttlSeconds: 600 },
  userMailViews: { prefix: 'user:mail-views', ttlSeconds: 300 },
}

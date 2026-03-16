// packages/lib/src/cache/org-cache-keys.ts

import type {
  CustomFieldEntity,
  OrganizationMemberInfo,
  OrganizationRole,
} from '@auxx/database/types'
import type { DehydratedOrganization } from '../dehydration/types'
import type { Inbox } from '../inboxes/types'
import type { Overage } from '../permissions/overage-detection-service'
import type { FeatureMapObject } from '../permissions/types'
import type { Resource } from '../resources/registry/types'

/** Member info cached with joined user data */
export interface OrgMemberInfo extends OrganizationMemberInfo {
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
    userType: string
  } | null
}

/** Dehydrated subscription shape (serializable) */
export type DehydratedSubscription = NonNullable<DehydratedOrganization['subscription']>

/** Dehydrated org profile (serializable) */
export interface DehydratedOrgProfile {
  id: string
  name: string | null
  website: string | null
  emailDomain: string | null
  handle: string | null
  about: string | null
  createdAt: string
  completedOnboarding: boolean
}

/** All org-scoped cache keys and their data types */
export interface OrgCacheDataMap {
  // Near-immutable
  entityDefs: Record<string, string> // entityType → entityDefId
  entityDefSlugs: Record<string, string> // apiSlug → entityDefId
  systemUser: string // system user ID
  integrationProviders: Record<string, string> // integrationId → provider

  // Membership & permissions
  members: OrgMemberInfo[]
  memberRoleMap: Record<string, OrganizationRole>

  // Business data
  features: FeatureMapObject
  subscription: DehydratedSubscription | null
  orgProfile: DehydratedOrgProfile
  resources: Resource[]
  customFields: Record<string, CustomFieldEntity[]> // entityDefId → fields
  inboxes: Inbox[]
  overages: Overage[]
}

export type OrgCacheKeyName = keyof OrgCacheDataMap

const THIRTY_DAYS = 60 * 60 * 24 * 30

/** Key configuration: prefix for Redis keys, TTL, and local-only flag */
export const ORG_CACHE_KEY_CONFIG: Record<
  OrgCacheKeyName,
  { prefix: string; ttlSeconds: number; localOnly?: boolean }
> = {
  // Near-immutable (30-day TTL, invalidated only on create/delete)
  entityDefs: { prefix: 'org:entity-defs', ttlSeconds: THIRTY_DAYS },
  entityDefSlugs: { prefix: 'org:entity-def-slugs', ttlSeconds: THIRTY_DAYS },
  systemUser: { prefix: 'org:system-user', ttlSeconds: THIRTY_DAYS },
  integrationProviders: { prefix: 'org:int-providers', ttlSeconds: 86400 },

  // Membership & permissions (15m TTL)
  members: { prefix: 'org:members', ttlSeconds: 900 },
  memberRoleMap: { prefix: 'org:member-roles', ttlSeconds: 900 },

  // Business data
  features: { prefix: 'org:features', ttlSeconds: 3600 },
  subscription: { prefix: 'org:subscription', ttlSeconds: 3600 },
  orgProfile: { prefix: 'org:profile', ttlSeconds: 3600 },
  resources: { prefix: 'org:resources', ttlSeconds: 900 },
  customFields: { prefix: 'org:custom-fields', ttlSeconds: 900 },
  inboxes: { prefix: 'org:inboxes', ttlSeconds: 300 },
  overages: { prefix: 'org:overages', ttlSeconds: 300 },
}

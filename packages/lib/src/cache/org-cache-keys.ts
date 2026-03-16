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
import type { SettingValue } from '../settings/types'
import type { CachedWorkflowApp } from './providers/workflow-apps-provider'

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

/** Dehydrated subscription shape (client-safe, serializable) */
export type DehydratedSubscription = NonNullable<DehydratedOrganization['subscription']>

/** Full cached subscription shape (server-only, JSON-serializable) */
export interface CachedSubscription {
  id: string
  organizationId: string
  status: string
  plan: string
  planId: string | null
  seats: number
  billingCycle: 'MONTHLY' | 'ANNUAL'
  periodStart: string | null
  periodEnd: string | null
  endDate: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  creditsBalance: number

  // Stripe identifiers (server-only — never send to client)
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null

  // Trial
  trialStart: string | null
  trialEnd: string | null
  hasTrialEnded: boolean
  trialConversionStatus: string | null
  isEligibleForTrial: boolean
  trialEligibilityReason: string | null

  // Scheduled changes
  scheduledPlanId: string | null
  scheduledPlan: string | null
  scheduledBillingCycle: 'MONTHLY' | 'ANNUAL' | null
  scheduledSeats: number | null
  scheduledChangeAt: string | null

  // Deletion
  lastDeletionNotificationSent: string | null
  lastDeletionNotificationDate: string | null
  deletionScheduledDate: string | null
  deletionReason: string | null

  // Custom/enterprise
  customFeatureLimits: unknown | null
  customPricingMonthly: number | null
  customPricingAnnual: number | null
  customPricingNotes: string | null
}

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

/** Dehydrated group instance for cache (JSON-serializable) */
export interface CachedGroup {
  id: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
  metadata: {
    memberCount?: number
    visibility?: string
    memberType?: string
    color?: string
    icon?: string
  }
}

/** Cached installed app shape (JSON-serializable) */
export interface CachedInstalledApp {
  installationId: string
  installationType: 'development' | 'production'
  installedAt: string // ISO string — rehydrate to Date before returning

  app: {
    id: string
    slug: string
    title: string
    description: string | null
    avatarUrl: string | null
    category: string | null
  }

  currentDeployment: {
    id: string
    version: string | null
    deploymentType: string
    status: string
    clientBundleSha: string
    createdAt: string // ISO string — rehydrate to Date before returning
  } | null

  /** Full ConnectionDefinitionSummary shape including oauth2Features */
  connectionDefinition?: {
    label: string | null
    global: boolean | null
    connectionType: string
    oauth2Features: Record<string, unknown> | null
  }
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
  subscription: CachedSubscription | null
  orgProfile: DehydratedOrgProfile
  resources: Resource[]
  customFields: Record<string, CustomFieldEntity[]> // entityDefId → fields
  groups: CachedGroup[] // all entity_group instances
  inboxes: Inbox[]
  overages: Overage[]
  orgSettings: Record<string, SettingValue> // key → value (org defaults only)
  installedApps: CachedInstalledApp[]
  workflowApps: CachedWorkflowApp[]
}

export type OrgCacheKeyName = keyof OrgCacheDataMap

const ONE_DAY = 60 * 60 * 24
const THIRTY_DAYS = ONE_DAY * 30

/** Key configuration: prefix for Redis keys, TTL, and local-only flag */
export const ORG_CACHE_KEY_CONFIG: Record<
  OrgCacheKeyName,
  { prefix: string; ttlSeconds: number; localOnly?: boolean }
> = {
  // Near-immutable (30-day TTL, invalidated only on create/delete)
  entityDefs: { prefix: 'org:entity-defs', ttlSeconds: THIRTY_DAYS },
  entityDefSlugs: { prefix: 'org:entity-def-slugs', ttlSeconds: THIRTY_DAYS },
  systemUser: { prefix: 'org:system-user', ttlSeconds: THIRTY_DAYS },
  integrationProviders: { prefix: 'org:int-providers', ttlSeconds: THIRTY_DAYS },

  // Membership & permissions (24h TTL, invalidated on member events)
  members: { prefix: 'org:members', ttlSeconds: ONE_DAY },
  memberRoleMap: { prefix: 'org:member-roles', ttlSeconds: ONE_DAY },

  // Business data (24h TTL, all invalidated via cache events)
  features: { prefix: 'org:features', ttlSeconds: THIRTY_DAYS },
  subscription: { prefix: 'org:subscription', ttlSeconds: ONE_DAY },
  orgProfile: { prefix: 'org:profile', ttlSeconds: ONE_DAY },
  resources: { prefix: 'org:resources', ttlSeconds: ONE_DAY },
  customFields: { prefix: 'org:custom-fields', ttlSeconds: ONE_DAY },
  groups: { prefix: 'org:groups', ttlSeconds: ONE_DAY },
  inboxes: { prefix: 'org:inboxes', ttlSeconds: ONE_DAY },
  overages: { prefix: 'org:overages', ttlSeconds: 900 },
  orgSettings: { prefix: 'org:settings', ttlSeconds: ONE_DAY },
  installedApps: { prefix: 'org:installed-apps', ttlSeconds: 900 },
  workflowApps: { prefix: 'org:workflow-apps', ttlSeconds: ONE_DAY },
}

// packages/lib/src/dehydration/service.ts

import { API_URL, DEV_PORTAL_URL, DOCS_URL, HOMEPAGE_URL, WEBAPP_URL } from '@auxx/config/client'
import { configService } from '@auxx/credentials'
import { getDeploymentMode } from '@auxx/deployment'
import { createScopedLogger } from '@auxx/logger'
import { execSync } from 'child_process'
import { getOrgCache, getUserCache } from '../cache'
import type { CachedSubscription } from '../cache/org-cache-keys'
import { SETTINGS_CATALOG } from '../settings'
import type { DehydratedEnvironment, DehydratedOrganization, DehydratedState } from './types'

const logger = createScopedLogger('dehydration-service')

/** Cached local git info so we only shell out once per process */
let cachedGitInfo: { sha: string; branch: string } | null = null

/** Get git SHA and branch from local repo (dev only, cached) */
function getLocalGitInfo(): { sha: string; branch: string } {
  if (cachedGitInfo) return cachedGitInfo
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
    cachedGitInfo = { sha, branch }
    return cachedGitInfo
  } catch {
    return { sha: 'unknown', branch: 'dev' }
  }
}

/**
 * Build environment configuration from env vars and build info.
 * Pure function — no DB or cache dependencies.
 */
export function buildEnvironment(): DehydratedEnvironment {
  return {
    deploymentMode: getDeploymentMode(),
    domain: configService.get<string>('DOMAIN') || '',
    appUrl: WEBAPP_URL || '',
    apiUrl: `${API_URL}/api/v1` || '',
    homepageUrl: HOMEPAGE_URL || '',
    docsUrl: DOCS_URL || '',
    devPortalUrl: DEV_PORTAL_URL || '',
    cdnUrl: configService.get<string>('CDN_URL') || '',
    turnstileSiteKey: configService.get<string>('TURNSTILE_SITE_KEY') || '',
    stripe: {
      publishableKey: configService.get<string>('STRIPE_PUBLISHABLE_KEY') || '',
    },
    pusher: {
      key: configService.get<string>('PUSHER_KEY') || '',
      cluster: configService.get<string>('PUSHER_CLUSTER') || '',
    },
    posthog: {
      key: configService.get<string>('POSTHOG_KEY') || '',
      host: configService.get<string>('POSTHOG_HOST') || 'https://app.posthog.com',
    },
    storage: {
      type: (configService.get<string>('FILE_STORAGE_TYPE') as 's3' | 'local') || 'local',
      bucket: configService.get<string>('S3_PUBLIC_BUCKET') || null,
      region: configService.get<string>('S3_REGION') || null,
    },
    demoEnabled: configService.get<boolean>('DEMO_ENABLED', false) === true,
    version: (() => {
      const gitSha = configService.get<string>('GIT_SHA')
      const isDev = !gitSha
      const git = isDev ? getLocalGitInfo() : null
      return {
        appVersion: configService.get<string>('APP_VERSION') || git?.branch || 'dev',
        commit: gitSha || git?.sha || 'unknown',
        buildTime: configService.get<string>('BUILD_TIME') || new Date().toISOString(),
        nodeEnv: configService.get<string>('NODE_ENV') || 'development',
      }
    })(),
  }
}

/**
 * Service for generating dehydrated state on the server.
 * Now assembles state from individual org/user cache reads instead of
 * a monolithic fetch-everything approach.
 */
export class DehydrationService {
  private orgCache = getOrgCache()
  private userCache = getUserCache()

  /**
   * Get complete dehydrated state for a user.
   * Reads from individual caches — no direct DB queries.
   */
  async getState(userId: string): Promise<DehydratedState> {
    // Ensure ConfigService is initialized (SST Resource + DB cache)
    await configService.init()

    // 1. Fetch user-level data (single call, multi-key)
    const { userProfile, userMemberships } = await this.userCache.getOrRecompute(userId, [
      'userProfile',
      'userMemberships',
    ])

    // 2. Fetch per-org data in parallel (skip orgs that no longer exist)
    const orgIds = userMemberships.map((m) => m.organizationId)
    const orgResults = await Promise.all(
      orgIds.map((orgId) =>
        this.assembleOrganization(userId, orgId).catch((err) => {
          logger.warn(`Skipping deleted/invalid org ${orgId} during dehydration`, {
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })
      )
    )
    const organizations = orgResults.filter((org): org is DehydratedOrganization => org !== null)

    // 3. Resolve organizationId — fall back if default org was deleted
    let organizationId = userProfile.defaultOrganizationId
    if (organizationId && !organizations.some((o) => o.id === organizationId)) {
      logger.warn(
        `User ${userId} defaultOrganizationId ${organizationId} not found in assembled orgs, falling back`
      )
      organizationId = organizations[0]?.id ?? null
    }

    // 4. Assemble (pure function, no DB calls)
    return {
      user: userProfile,
      organizationId,
      organizations,
      settingsCatalog: SETTINGS_CATALOG,
      environment: buildEnvironment(),
      timestamp: Date.now(),
    }
  }

  /**
   * Assemble a single organization's dehydrated state from cache reads.
   */
  private async assembleOrganization(
    userId: string,
    orgId: string
  ): Promise<DehydratedOrganization> {
    const [orgData, userData] = await Promise.all([
      // Org-scoped: features, subscription, profile, overages, channelProviders
      this.orgCache.getOrRecompute(orgId, [
        'features',
        'subscription',
        'orgProfile',
        'overages',
        'channelProviders',
      ]),
      // User+org-scoped: settings
      this.userCache.getOrRecompute(userId, ['userSettings'], orgId),
    ])

    const { features, subscription, orgProfile, overages, channelProviders } = orgData

    const providers = Object.values(channelProviders)
    const hasIntegrations = providers.length > 0
    const hasOnlyForwardingChannel = hasIntegrations && providers.every((p) => p === 'email')

    return {
      id: orgProfile.id,
      name: orgProfile.name,
      website: orgProfile.website,
      domains: orgProfile.domains,
      handle: orgProfile.handle,
      about: orgProfile.about,
      createdAt: orgProfile.createdAt,
      completedOnboarding: orgProfile.completedOnboarding,
      demoExpiresAt: orgProfile.demoExpiresAt,
      subscription: toClientSubscription(subscription),
      features: features ?? {},
      overages,
      settings: userData.userSettings,
      hasIntegrations,
      hasOnlyForwardingChannel,
    }
  }

  /**
   * Get environment-only state for unauthenticated pages (no DB queries).
   * Async to future-proof for Redis lookups (e.g. feature flags, A/B config).
   */
  async getPublicState(): Promise<DehydratedState> {
    // Ensure ConfigService is initialized (SST Resource + DB cache)
    await configService.init()

    return {
      organizationId: null,
      organizations: [],
      settingsCatalog: {},
      environment: buildEnvironment(),
      timestamp: Date.now(),
    }
  }

  /**
   * Temporary compat — invalidate + eager recompute for a single user.
   * Callers should eventually use specific onCacheEvent() calls.
   */
  async refreshUser(userId: string): Promise<void> {
    await this.userCache.invalidateUser(userId)
  }

  /**
   * Temporary compat — invalidate all org keys.
   * Callers should eventually use specific onCacheEvent() calls.
   */
  async refreshOrganization(organizationId: string): Promise<void> {
    await this.orgCache.flush(organizationId)
  }

  /** @deprecated Use onCacheEvent() instead */
  async invalidateUser(userId: string): Promise<void> {
    await this.userCache.invalidateUser(userId)
  }

  /** @deprecated Use onCacheEvent() instead */
  async invalidateOrganization(organizationId: string): Promise<void> {
    await this.orgCache.flush(organizationId)
  }

  /** @deprecated Use onCacheEvent() with member events instead */
  async invalidateOrganizationMembers(organizationId: string): Promise<void> {
    // Fetch members from cache and invalidate each user
    const { members } = await this.orgCache.getOrRecompute(organizationId, ['members'])
    await Promise.all(members.map((m) => this.userCache.invalidateUser(m.userId)))
  }
}

/** Strip server-only fields from CachedSubscription for client delivery */
function toClientSubscription(
  sub: CachedSubscription | null
): DehydratedOrganization['subscription'] {
  if (!sub) return null
  return {
    id: sub.id,
    status: sub.status,
    plan: sub.plan,
    planId: sub.planId,
    seats: sub.seats,
    billingCycle: sub.billingCycle,
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt,
    trialStart: sub.trialStart,
    trialEnd: sub.trialEnd,
    hasTrialEnded: sub.hasTrialEnded,
    isEligibleForTrial: sub.isEligibleForTrial,
    scheduledPlanId: sub.scheduledPlanId,
    scheduledPlan: sub.scheduledPlan,
    scheduledBillingCycle: sub.scheduledBillingCycle,
    scheduledSeats: sub.scheduledSeats,
    scheduledChangeAt: sub.scheduledChangeAt,
  }
}

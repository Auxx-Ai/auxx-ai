// packages/lib/src/dehydration/service.ts

import {
  API_URL,
  DEV_PORTAL_URL,
  DOCS_URL,
  env,
  HOMEPAGE_URL,
  WEBAPP_URL,
} from '@auxx/config/client'
import { type Database, database as ddb, schema } from '@auxx/database'
import { getDeploymentMode } from '@auxx/deployment'
import { execSync } from 'child_process'
import { count, eq } from 'drizzle-orm'
import { MediaAssetService } from '../files'
import { createScopedLogger } from '../logger'
import { FeaturePermissionService } from '../permissions'
import { SETTINGS_CATALOG, SettingsService } from '../settings'
import { DehydrationCacheService } from './cache'
import type {
  DehydratedEnvironment,
  DehydratedOrganization,
  DehydratedState,
  DehydratedUser,
} from './types'

const logger = createScopedLogger('DehydrationService', { color: 'blue' })

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
    appUrl: WEBAPP_URL || '',
    apiUrl: `${API_URL}/api/v1` || '',
    homepageUrl: HOMEPAGE_URL || '',
    docsUrl: DOCS_URL || '',
    devPortalUrl: DEV_PORTAL_URL || '',
    cdnUrl: '',
    stripe: {
      publishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
    },
    pusher: {
      key: env.NEXT_PUBLIC_PUSHER_KEY || '',
      cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
    },
    posthog: {
      key: env.NEXT_PUBLIC_POSTHOG_KEY || '',
      host: env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
    },
    storage: {
      type: (env.NEXT_PUBLIC_STORAGE_TYPE as 's3' | 'local') || 'local',
      bucket: env.NEXT_PUBLIC_S3_BUCKET || null,
      region: env.NEXT_PUBLIC_S3_REGION || null,
    },
    version: (() => {
      const isDev = !env.NEXT_PUBLIC_GIT_SHA
      const git = isDev ? getLocalGitInfo() : null
      return {
        appVersion: env.NEXT_PUBLIC_APP_VERSION || git?.branch || 'dev',
        commit: env.NEXT_PUBLIC_GIT_SHA || git?.sha || 'unknown',
        buildTime: env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString(),
        nodeEnv: env.NEXT_PUBLIC_ENV || 'development',
      }
    })(),
  }
}

/**
 * Service for generating dehydrated state on the server
 * Aggregates user, organization, subscription, and feature data
 */
export class DehydrationService {
  private cache: DehydrationCacheService
  private db: Database

  constructor(db?: unknown) {
    this.db = db && typeof (db as any).select === 'function' ? (db as Database) : (ddb as Database)
    this.cache = new DehydrationCacheService()
  }

  /**
   * Get complete dehydrated state for a user
   * Uses cache with fallback to database
   * @param userId - User ID
   * @returns Complete dehydrated state
   */
  async getState(userId: string): Promise<DehydratedState> {
    // Try cache first
    const cached = await this.cache.getState(userId)
    if (cached) {
      logger.debug(`Cache hit for user ${userId}`)
      return cached
    }

    logger.debug(`Cache miss for user ${userId}, fetching fresh data`)

    // Fetch fresh data
    const state = await this.fetchState(userId)

    // Cache it
    await this.cache.setState(userId, state)

    return state
  }

  /**
   * Fetch fresh state from database
   * @private
   */
  private async fetchState(userId: string): Promise<DehydratedState> {
    // Fetch user with memberships
    const user = await this.fetchUser(userId)

    // Fetch all organizations user is member of
    const organizations = await this.fetchOrganizations(userId)

    // Build environment config
    const environment = this.buildEnvironment()

    return {
      user,
      organizationId: user.defaultOrganizationId,
      organizations,
      settingsCatalog: SETTINGS_CATALOG,
      environment,
      timestamp: Date.now(),
    }
  }

  /**
   * Fetch user data with memberships and avatar
   * @private
   */
  private async fetchUser(userId: string): Promise<DehydratedUser> {
    // Fetch user
    const [user] = await this.db
      .select()
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user) {
      throw new Error(`User not found: ${userId}`)
    }

    // Fetch memberships
    const memberships = await this.db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        status: schema.OrganizationMember.status,
      })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.userId, userId))

    // Fetch avatar URL if available
    let avatarUrl: string | null = null
    if (user.avatarAssetId && user.defaultOrganizationId) {
      const mediaAssetService = new MediaAssetService(user.defaultOrganizationId, userId, this.db)
      try {
        avatarUrl = await mediaAssetService.getDownloadUrl(user.avatarAssetId)
      } catch (error) {
        logger.warn(`Failed to fetch avatar URL for user ${userId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Fetch user's authentication providers (same logic as customSession)
    const accounts = await this.db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.userId, userId))

    const providerIds = accounts.map((a) => a.providerId)
    const hasPassword = providerIds.includes('credential')
    const oauthProviders = providerIds.filter((p) => p !== 'credential')

    // Determine registration method
    const authMethodCount =
      (hasPassword ? 1 : 0) +
      (oauthProviders.length > 0 ? 1 : 0) +
      (user.phoneNumberVerified ? 1 : 0)

    let registrationMethod: 'oauth' | 'email' | 'phone' | 'mixed' = 'oauth'

    if (authMethodCount > 1) {
      registrationMethod = 'mixed'
    } else if (hasPassword) {
      registrationMethod = 'email'
    } else if (user.phoneNumberVerified) {
      registrationMethod = 'phone'
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: avatarUrl,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
      completedOnboarding: user.completedOnboarding,
      defaultOrganizationId: user.defaultOrganizationId,
      lastLoginAt: user.lastLoginAt,
      preferredTimezone: user.preferredTimezone,
      providers: oauthProviders,
      hasPassword,
      isSuperAdmin: user.isSuperAdmin,
      registrationMethod,
      memberships: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        role: m.role,
        status: m.status,
      })),
    }
  }

  /**
   * Fetch all organizations for a user with subscriptions, features, and settings
   * @private
   */
  private async fetchOrganizations(userId: string): Promise<DehydratedOrganization[]> {
    // Get all organization IDs from memberships
    const memberships = await this.db
      .select({ organizationId: schema.OrganizationMember.organizationId })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.userId, userId))

    const organizationIds = memberships.map((m) => m.organizationId)

    // Fetch each organization with all its data
    const organizations = await Promise.all(
      organizationIds.map((orgId) => this.fetchOrganization(userId, orgId))
    )

    return organizations
  }

  /**
   * Fetch a single organization with all related data
   * @private
   */
  private async fetchOrganization(
    userId: string,
    organizationId: string
  ): Promise<DehydratedOrganization> {
    // Fetch organization
    const [org] = await this.db
      .select()
      .from(schema.Organization)
      .where(eq(schema.Organization.id, organizationId))
      .limit(1)

    if (!org) {
      throw new Error(`Organization not found: ${organizationId}`)
    }

    // Fetch subscription
    const [subscription] = await this.db
      .select()
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, organizationId))
      .limit(1)

    // Fetch features
    const featureService = new FeaturePermissionService(this.db)
    const features = (await featureService.getOrganizationFeaturesMap(organizationId)) || {}

    // Fetch user settings for this org
    const settingsService = new SettingsService(this.db)
    const settings = await settingsService.getAllUserSettings({ userId, organizationId })

    // Check for integrations
    const [{ integrationCount }] = await this.db
      .select({ integrationCount: count() })
      .from(schema.Integration)
      .where(eq(schema.Integration.organizationId, organizationId))
    const hasIntegrations = integrationCount > 0

    return {
      id: org.id,
      name: org.name,
      website: org.website,
      emailDomain: org.emailDomain,
      handle: org.handle,
      about: org.about,
      createdAt: org.createdAt.toISOString(),
      completedOnboarding: org.completedOnboarding ?? false,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            plan: subscription.plan,
            planId: subscription.planId,
            seats: subscription.seats,
            billingCycle: subscription.billingCycle,
            periodStart: subscription.periodStart?.toISOString() ?? null,
            periodEnd: subscription.periodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt?.toISOString() ?? null,
            trialStart: subscription.trialStart?.toISOString() ?? null,
            trialEnd: subscription.trialEnd?.toISOString() ?? null,
            hasTrialEnded: subscription.hasTrialEnded,
            isEligibleForTrial: subscription.isEligibleForTrial,
            scheduledPlanId: subscription.scheduledPlanId,
            scheduledPlan: subscription.scheduledPlan,
            scheduledBillingCycle: subscription.scheduledBillingCycle,
            scheduledSeats: subscription.scheduledSeats,
            scheduledChangeAt: subscription.scheduledChangeAt?.toISOString() ?? null,
          }
        : null,
      features,
      settings,
      hasIntegrations,
    }
  }

  /**
   * Get environment-only state for unauthenticated pages (no DB queries).
   * Async to future-proof for Redis lookups (e.g. feature flags, A/B config).
   */
  async getPublicState(): Promise<DehydratedState> {
    return {
      organizationId: null,
      organizations: [],
      settingsCatalog: {},
      environment: this.buildEnvironment(),
      timestamp: Date.now(),
    }
  }

  /**
   * Build environment configuration from env vars and build info
   * @private — delegates to the standalone buildEnvironment() function
   */
  private buildEnvironment(): DehydratedEnvironment {
    return buildEnvironment()
  }

  /**
   * Invalidate cache for a specific user
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId)
  }

  /**
   * Invalidate cache for all users in an organization
   */
  async invalidateOrganization(organizationId: string): Promise<void> {
    await this.cache.invalidateOrganization(organizationId)
  }

  /**
   * Invalidate all members of an organization
   */
  async invalidateOrganizationMembers(organizationId: string): Promise<void> {
    const members = await this.db
      .select({ userId: schema.OrganizationMember.userId })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.organizationId, organizationId))

    await Promise.all(members.map((m) => this.cache.invalidateUser(m.userId)))
  }
}

// apps/build/src/lib/dehydration/service.ts

import { database as ddb, type Database } from '@auxx/database'
import { BuildDehydrationCacheService } from './cache'
import { createScopedLogger } from '@auxx/logger'
import { DEV_PORTAL_URL, WEBAPP_URL } from '@auxx/config/client'
import { getUser } from '@auxx/services/users'
import {
  listDeveloperAccounts,
  listDeveloperAccountMembers,
} from '@auxx/services/developer-accounts'
import { listAppsForUser } from '@auxx/services/apps'
import { listUserOrganizations } from '@auxx/services/organization-members'
import type {
  BuildDehydratedState,
  DehydratedBuildUser,
  DehydratedDeveloperAccount,
  DehydratedApp,
  DehydratedOrganization,
  DehydratedDeveloperAccountInvitation,
  DehydratedBuildEnvironment,
} from './types'

const logger = createScopedLogger('build-dehydration-service')

/**
 * Service for generating dehydrated state for developer portal
 * Aggregates user, developer accounts, apps, and invitations
 */
export class BuildDehydrationService {
  private cache: BuildDehydrationCacheService
  private db: Database

  constructor(db?: unknown) {
    this.db = db && typeof (db as any).select === 'function' ? (db as Database) : (ddb as Database)
    this.cache = new BuildDehydrationCacheService()
  }

  /**
   * Get complete dehydrated state for a user
   * @param userId - User ID from session
   * @returns Complete dehydrated state
   */
  async getState(userId: string): Promise<BuildDehydratedState> {
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
  private async fetchState(userId: string): Promise<BuildDehydratedState> {
    // Fetch user
    const user = await this.fetchUser(userId)

    // Fetch developer accounts with members
    const developerAccounts = await this.fetchDeveloperAccounts(userId)

    // Fetch all apps user has access to
    const apps = await this.fetchApps(userId)

    // Fetch all organizations user is a member of
    const organizations = await this.fetchOrganizations(userId)

    // Fetch pending invitations (empty for now - schema doesn't support invitations)
    const invitedDeveloperAccounts: DehydratedDeveloperAccountInvitation[] = []

    // Build environment config
    const environment = this.buildEnvironment()

    return {
      authenticatedUser: user,
      developerAccounts,
      apps,
      organizations,
      invitedDeveloperAccounts,
      environment,
      timestamp: Date.now(),
    }
  }

  /**
   * Fetch user data
   * @private
   */
  private async fetchUser(userId: string): Promise<DehydratedBuildUser> {
    const result = await getUser({ userId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to fetch user for dehydration', { error, userId })

      if (error.code === 'USER_NOT_FOUND') {
        throw new Error(`User not found: ${userId}`)
      }

      throw new Error(`Failed to fetch user: ${error.message}`)
    }

    const user = result.value!

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  /**
   * Fetch all developer accounts for a user with members
   * @private
   */
  private async fetchDeveloperAccounts(userId: string): Promise<DehydratedDeveloperAccount[]> {
    const result = await listDeveloperAccounts({ userId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to fetch developer accounts for dehydration', { error, userId })
      throw new Error(`Failed to fetch developer accounts: ${error.message}`)
    }

    // Fetch members for each account
    const accounts = await Promise.all(
      result.value.accounts.map(async (account) => {
        const membersResult = await listDeveloperAccountMembers({
          developerAccountId: account.id,
          userId,
        })

        if (membersResult.isErr()) {
          const error = membersResult.error
          logger.error('Failed to fetch members for developer account', {
            error,
            developerAccountId: account.id,
          })
          throw new Error(`Failed to fetch members for account ${account.id}: ${error.message}`)
        }

        const { members, userMember } = membersResult.value

        return {
          id: account.id,
          title: account.title,
          slug: account.slug,
          logoId: account.logoId,
          logoUrl: account.logoUrl,
          featureFlags: account.featureFlags,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          userMember: {
            id: userMember.id,
            userId: userMember.userId,
            accessLevel: userMember.accessLevel as 'admin' | 'member',
            createdAt: userMember.createdAt,
          },
          members: members.map((m) => ({
            id: m.id,
            userId: m.userId,
            userName: m.user.name,
            userEmail: m.user.email,
            userImage: m.user.image,
            accessLevel: m.accessLevel as 'admin' | 'member',
            createdAt: m.createdAt,
          })),
        }
      })
    )

    return accounts
  }

  /**
   * Fetch all apps user has access to with full data
   * @private
   */
  private async fetchApps(userId: string) {
    const result = await listAppsForUser({ userId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to fetch apps for dehydration', { error, userId })
      throw new Error(`Failed to fetch apps: ${error.message}`)
    }

    // Return the full app objects as-is
    return result.value.apps!
  }

  /**
   * Fetch all organizations user is a member of
   * @private
   */
  private async fetchOrganizations(userId: string) {
    const result = await listUserOrganizations({ userId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to fetch organizations for dehydration', { error, userId })
      throw new Error(`Failed to fetch organizations: ${error.message}`)
    }

    // Map to include id, name, handle, and slug
    return result.value.map((org) => ({
      id: org.id,
      name: org.name,
      handle: org.handle,
      slug: org.handle, // slug is same as handle for organizations
    }))
  }

  /**
   * Build environment configuration
   * @private
   */
  private buildEnvironment(): DehydratedBuildEnvironment {
    return {
      devPortalUrl: DEV_PORTAL_URL || '',
      webappUrl: WEBAPP_URL || '',
      nodeEnv: process.env.NODE_ENV || 'development',
      isDevelopment: process.env.NODE_ENV === 'development',
    }
  }

  /**
   * Invalidate cache for a specific user
   */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId)
  }

  /**
   * Invalidate cache for all members of a developer account
   */
  async invalidateDeveloperAccount(developerAccountId: string): Promise<void> {
    const members = await this.db.query.DeveloperAccountMember.findMany({
      where: (members, { eq }) => eq(members.developerAccountId, developerAccountId),
      columns: {
        userId: true,
      },
    })

    await Promise.all(members.map((m) => this.cache.invalidateUser(m.userId)))
  }
}

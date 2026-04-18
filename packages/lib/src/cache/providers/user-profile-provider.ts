// packages/lib/src/cache/providers/user-profile-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { DehydratedUser } from '../../dehydration/types'
import { MediaAssetService } from '../../files'
import { createScopedLogger } from '../../logger'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('user-profile-provider')

/** Computes the dehydrated user profile */
export const userProfileProvider: CacheProvider<DehydratedUser> = {
  async compute(userId, db) {
    const [user] = await db.select().from(schema.User).where(eq(schema.User.id, userId)).limit(1)

    if (!user) {
      // Throw rather than return null: a null result would be cached and
      // crash every subsequent dehydration call. Throwing lets callers (cache
      // invalidation try/catch, dehydration error boundary) recover instead.
      throw new Error(`User not found in DB for userId: ${userId}`)
    }

    // Fetch memberships
    const memberships = await db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        status: schema.OrganizationMember.status,
      })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.userId, userId))

    // Fetch avatar URL
    let avatarUrl: string | null = null
    if (user.avatarAssetId && user.defaultOrganizationId) {
      const mediaAssetService = new MediaAssetService(user.defaultOrganizationId, userId, db)
      try {
        avatarUrl = await mediaAssetService.getDownloadUrl(user.avatarAssetId)
      } catch (error) {
        logger.warn(`Failed to fetch avatar URL for user ${userId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Fetch auth providers
    const accounts = await db
      .select({ providerId: schema.account.providerId })
      .from(schema.account)
      .where(eq(schema.account.userId, userId))

    const providerIds = accounts.map((a) => a.providerId)
    const hasPassword = providerIds.includes('credential')
    const oauthProviders = providerIds.filter((p) => p !== 'credential')

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
  },
}

// packages/lib/src/users/system-user-service.ts
import { database as db, schema } from '@auxx/database'
import type { UserEntity, UserType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('system-user-service')

/** Prepared statement to get user by ID */
const getUserByIdStmt = db
  .select()
  .from(schema.User)
  .where(eq(schema.User.id, '$1'))
  .limit(1)
  .prepare('getUserByIdStmt')

// Note: Removed prepared statement to prevent stale cache issues after schema changes
// This query is not a hot path and doesn't benefit significantly from preparation

/** Prepared statement to get user type by ID */
const getUserTypeStmt = db
  .select({ userType: schema.User.userType })
  .from(schema.User)
  .where(eq(schema.User.id, '$1'))
  .limit(1)
  .prepare('getUserTypeStmt')
/**
 * Static service for managing system users - AI/automated users that perform actions
 * on behalf of the system rather than real users
 */
export class SystemUserService {
  private static async getRedisClient(): Promise<RedisClient | null> {
    try {
      return await getRedisClient(false) // Optional Redis
    } catch (error) {
      logger.debug('Redis unavailable, using DB only', { error })
      return null
    }
  }
  /**
   * Get the system user for a given organization
   * @param organizationId The organization ID
   * @returns The system user or null if not found
   */
  static async getOrganizationSystemUser(organizationId: string): Promise<UserEntity | null> {
    try {
      logger.debug('getOrganizationSystemUser: getting Redis client', { organizationId })
      const redisClient = await SystemUserService.getRedisClient()
      // Check Redis cache first
      if (redisClient) {
        logger.debug('getOrganizationSystemUser: checking Redis cache', { organizationId })
        const cachedUserId = await redisClient.get(`system-user:org:${organizationId}`)
        logger.debug('getOrganizationSystemUser: Redis cache result', {
          organizationId,
          cachedUserId,
        })
        if (cachedUserId) {
          const [systemUser] = await getUserByIdStmt.execute({ $1: cachedUserId })
          if (systemUser) {
            return systemUser
          }
          // Cache was stale/invalid, invalidate it and fall through to DB query
          logger.warn('Stale cache detected for organization system user, invalidating', {
            organizationId,
            cachedUserId,
          })
          await redisClient.del(`system-user:org:${organizationId}`)
        }
      }
      // Fallback to database (using regular query to avoid prepared statement cache issues)
      logger.debug('getOrganizationSystemUser: querying DB', { organizationId })
      const orgWithUser = await db
        .select({
          organization: schema.Organization,
          systemUser: schema.User,
        })
        .from(schema.Organization)
        .leftJoin(schema.User, eq(schema.Organization.systemUserId, schema.User.id))
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)
      logger.debug('getOrganizationSystemUser: DB query complete', { organizationId })

      const systemUser = orgWithUser[0]?.systemUser || null
      // Cache the system user ID if found
      if (redisClient && systemUser) {
        await redisClient.setex(`system-user:org:${organizationId}`, 86400, systemUser.id)
      }
      return systemUser
    } catch (error) {
      logger.error('Failed to get organization system user', { organizationId, error })
      return null
    }
  }
  /**
   * Create a system user for an organization (used in migrations/seeding)
   * @param organizationId The organization ID
   * @param organizationName The organization name for the system user name
   * @returns The created system user
   */
  static async createSystemUserForOrganization(
    organizationId: string,
    organizationName?: string
  ): Promise<UserEntity> {
    try {
      // Check if organization already has a system user
      logger.info('createSystemUser: checking for existing system user', { organizationId })
      const existingSystemUser = await SystemUserService.getOrganizationSystemUser(organizationId)
      if (existingSystemUser) {
        logger.warn('Organization already has a system user', {
          organizationId,
          existingSystemUser: existingSystemUser.id,
        })
        return existingSystemUser
      }
      logger.info('createSystemUser: no existing system user, proceeding', { organizationId })

      // Invalidate any stale cache before creating
      logger.info('createSystemUser: invalidating cache', { organizationId })
      await SystemUserService.invalidateSystemUserCache(organizationId)
      logger.info('createSystemUser: cache invalidated, starting transaction', { organizationId })

      // Use transaction to ensure atomicity
      const systemUser = await db.transaction(async (tx) => {
        // Create the system user
        logger.info('createSystemUser: inserting system user', { organizationId })
        const [newUser] = await tx
          .insert(schema.User)
          .values({
            name: 'Auxx.ai',
            email: null,
            emailVerified: false,
            completedOnboarding: true,
            userType: 'SYSTEM' as UserType,
            defaultOrganizationId: organizationId,
            updatedAt: new Date(),
          })
          .returning()
        logger.info('createSystemUser: system user inserted, linking to org', {
          organizationId,
          systemUserId: newUser!.id,
        })

        // Link system user to organization
        await tx
          .update(schema.Organization)
          .set({ systemUserId: newUser!.id })
          .where(eq(schema.Organization.id, organizationId))
        logger.info('createSystemUser: org linked, committing', { organizationId })

        return newUser!
      })
      logger.info('createSystemUser: transaction committed, caching', { organizationId })

      // Cache the new system user ID AFTER transaction commits
      const redisClient = await SystemUserService.getRedisClient()
      if (redisClient) {
        await redisClient.setex(`system-user:org:${organizationId}`, 86400, systemUser.id)
      }
      logger.info('createSystemUser: cached', { organizationId })

      logger.info('Created system user for organization', {
        organizationId,
        systemUserId: systemUser.id,
        systemUserName: systemUser.name,
      })
      return systemUser
    } catch (error) {
      logger.error('Failed to create system user for organization', { organizationId, error })
      throw error
    }
  }
  /**
   * Check if a user is a system user with Redis caching
   * @param userId The user ID to check
   * @returns True if the user is a system user
   */
  static async isSystemUser(userId: string): Promise<boolean> {
    try {
      const redisClient = await SystemUserService.getRedisClient()
      // Check Redis cache first
      if (redisClient) {
        const cachedResult = await redisClient.get(`user-type:${userId}`)
        if (cachedResult !== null) {
          return cachedResult === 'SYSTEM'
        }
      }
      // Fallback to database
      const [user] = await getUserTypeStmt.execute({ $1: userId })
      const isSystem = user?.userType === 'SYSTEM'
      // Cache the result
      if (redisClient && user) {
        await redisClient.setex(`user-type:${userId}`, 3600, user.userType) // Cache for 1 hour
      }
      return isSystem
    } catch (error) {
      logger.error('Failed to check if user is system user', { userId, error })
      return false
    }
  }
  /**
   * Helper method to get system user for actions
   * This is the main method AI services should use to get the system user for automated actions
   * @param organizationId The organization ID
   * @returns The system user ID or throws if not found
   */
  static async getSystemUserForActions(organizationId: string): Promise<string> {
    const systemUser = await SystemUserService.getOrganizationSystemUser(organizationId)
    if (!systemUser) {
      logger.error('No system user found for organization', { organizationId })
      throw new Error(`No system user found for organization ${organizationId}`)
    }
    return systemUser.id
  }
  /**
   * Invalidate cached system user for an organization
   * @param organizationId The organization ID
   */
  static async invalidateSystemUserCache(organizationId: string): Promise<void> {
    const redisClient = await SystemUserService.getRedisClient()
    if (redisClient) {
      try {
        await redisClient.del(`system-user:org:${organizationId}`)
      } catch (error) {
        logger.warn('Failed to invalidate system user cache', { organizationId, error })
      }
    }
  }
}

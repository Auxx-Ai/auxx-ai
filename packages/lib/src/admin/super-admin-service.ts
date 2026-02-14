// packages/lib/src/admin/super-admin-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('super-admin-service')

/**
 * Service for managing super admin users
 */
export class SuperAdminService {
  constructor(private db: Database = defaultDb) {}

  /**
   * Promote a user to super admin by email
   * @param email - Email of the user to promote
   * @returns The updated user or null if not found
   */
  async promoteUserToSuperAdmin(email: string): Promise<boolean> {
    logger.info('Attempting to promote user to super admin', { email })

    try {
      // Find user by email
      const [user] = await this.db
        .select({ id: schema.User.id, isSuperAdmin: schema.User.isSuperAdmin })
        .from(schema.User)
        .where(eq(schema.User.email, email))
        .limit(1)

      if (!user) {
        logger.warn('User not found for super admin promotion', { email })
        return false
      }

      if (user.isSuperAdmin) {
        logger.info('User is already a super admin', { email, userId: user.id })
        return true
      }

      // Update user to super admin
      await this.db
        .update(schema.User)
        .set({ isSuperAdmin: true, updatedAt: new Date() })
        .where(eq(schema.User.email, email))

      logger.info('Successfully promoted user to super admin', { email, userId: user.id })
      return true
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to promote user to super admin', { email, error: errorMsg })
      throw error
    }
  }

  /**
   * Check if a user is a super admin by email
   * @param email - Email of the user to check
   * @returns True if user is super admin, false otherwise
   */
  async isSuperAdmin(email: string): Promise<boolean> {
    const [user] = await this.db
      .select({ isSuperAdmin: schema.User.isSuperAdmin })
      .from(schema.User)
      .where(eq(schema.User.email, email))
      .limit(1)

    return user?.isSuperAdmin ?? false
  }

  /**
   * Remove super admin privileges from a user by email
   * @param email - Email of the user to demote
   * @returns True if successful, false if user not found
   */
  async demoteUserFromSuperAdmin(email: string): Promise<boolean> {
    logger.info('Attempting to demote user from super admin', { email })

    try {
      const [user] = await this.db
        .select({ id: schema.User.id, isSuperAdmin: schema.User.isSuperAdmin })
        .from(schema.User)
        .where(eq(schema.User.email, email))
        .limit(1)

      if (!user) {
        logger.warn('User not found for super admin demotion', { email })
        return false
      }

      if (!user.isSuperAdmin) {
        logger.info('User is not a super admin', { email, userId: user.id })
        return true
      }

      await this.db
        .update(schema.User)
        .set({ isSuperAdmin: false, updatedAt: new Date() })
        .where(eq(schema.User.email, email))

      logger.info('Successfully demoted user from super admin', { email, userId: user.id })
      return true
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to demote user from super admin', { email, error: errorMsg })
      throw error
    }
  }
}

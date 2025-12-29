// lib/organization/organization-hooks.ts
import { type Database } from '@auxx/database'
// import { OrganizationSeeder } from './organization-seeder'
import { createScopedLogger } from '@auxx/logger'
import { OrganizationSeeder } from '../seed/organization-seeder'

const logger = createScopedLogger('organization-hooks')

/**
 * Hooks for organization lifecycle events
 */
export class OrganizationHooks {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  /**
   * Handle post-creation tasks for a new organization
   * This should be called after a new organization record is created
   * @param organizationId The newly created organization ID
   * @param userId The user ID who created the organization
   * @param userEmail Optional email for trial subscription creation
   */
  async afterOrganizationCreated(
    organizationId: string,
    userId: string,
    userEmail?: string
  ): Promise<void> {
    logger.info('Handling post-creation tasks for organization', { organizationId })

    try {
      const seeder = new OrganizationSeeder(this.db, userId, userEmail)
      await seeder.seedNewOrganization(organizationId)

      logger.info('Successfully completed post-creation tasks', { organizationId })
    } catch (error) {
      logger.error('Failed to complete post-creation tasks', { organizationId, error })
      // We're logging the error but not rethrowing, to prevent
      // the organization creation itself from failing if seeding fails
    }
  }
}

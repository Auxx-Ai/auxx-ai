// src/lib/billing/plan-enforcement-service.ts
import { database as db, schema, type Database } from '@auxx/database'
import { OrganizationMemberStatus, OrganizationRole } from '@auxx/database/enums'
import { eq, and, ne, desc, sql, inArray } from 'drizzle-orm'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'
// import type { Redis } from 'ioredis' // Assuming you use ioredis
// import { createScopedLogger } from '@auxx/logger';
import type { FeatureMap } from '../permissions/feature-permission-service' // Import type if defined
import { createScopedLogger } from '../logger'
const logger = createScopedLogger('plan-enforcement-service')
export class PlanEnforcementService {
  private db: Database
  private featurePermissionService: FeaturePermissionService
  // private redis: Redis; // Add if needed for locking
  constructor(
    db: Database,
    featurePermissionService: FeaturePermissionService /* , _redis?: Redis */
  ) {
    this.db = db
    this.featurePermissionService = featurePermissionService
    // this.redis = redis; // Store if needed
  }
  /**
   * Enforces all relevant plan limits for an organization based on its current subscription.
   * This should be called AFTER the plan change is reflected in the database
   * and the feature cache has been invalidated.
   * @param organizationId The ID of the organization to enforce limits for.
   */
  async enforceLimits(organizationId: string): Promise<void> {
    logger.info(`Starting plan limit enforcement for organization ${organizationId}`)
    // Optional: Implement locking mechanism here if called from multiple places (sync + async)
    // const lockKey = `enforce-lock:${organizationId}`;
    // const acquired = await acquireLock(this.redis, lockKey, 30000); // 30 sec expiry
    // if (!acquired) {
    //     logger.warn(`Could not acquire enforcement lock for org ${organizationId}. Skipping.`);
    //     return;
    // }
    try {
      // 1. Get the NEW feature map (cache should be invalidated before calling this)
      const featureMap = await this.featurePermissionService.getOrganizationFeatures(organizationId)
      if (!featureMap) {
        logger.error(
          `Cannot enforce limits: Failed to retrieve feature map for org ${organizationId}`
        )
        return // Or throw? Depending on desired handling
      }
      // 2. Enforce limits for each feature type
      await this.enforceMemberLimit(organizationId, featureMap)
      await this.enforceRuleLimit(organizationId, featureMap)
      await this.enforceIntegrationLimit(organizationId, featureMap)
      // Add calls for other features here...
      logger.info(`Finished plan limit enforcement for organization ${organizationId}`)
    } catch (error: any) {
      logger.error(`Error during plan limit enforcement for organization ${organizationId}`, {
        error: error.message,
        stack: error.stack,
      })
      // Decide if you want to re-throw or just log
    } finally {
      // Optional: Release lock
      // await releaseLock(this.redis, lockKey);
    }
  }
  // --- Specific Feature Enforcement Methods ---
  /**
   * Enforces the member limit based on the current plan.
   * Deactivates excess members if necessary.
   */
  private async enforceMemberLimit(organizationId: string, featureMap: FeatureMap): Promise<void> {
    const limit = featureMap.get(FeatureKey.TEAMMATES)
    // Only enforce numeric limits (ignore '+', false, null, 0)
    if (typeof limit !== 'number' || limit <= 0) {
      if (limit !== '+') {
        // Don't log for unlimited ('+')
        logger.debug(
          `Skipping member limit enforcement for org ${organizationId}: Limit is not a positive number (${limit}).`
        )
      }
      // If limit is exactly 0, you might want logic to deactivate *all* non-owner members.
      // Be cautious with this logic.
      // Example for limit 0:
      // if (limit === 0) {
      //    const deactivatedCount = await this.db.organizationMember.updateMany({
      //       where: { organizationId, role: { not: OrganizationRole.OWNER }, status: OrganizationMemberStatus.ACTIVE },
      //       data: { status: OrganizationMemberStatus.INACTIVE }
      //    });
      //    if (deactivatedCount > 0) logger.info(`Deactivated ${deactivatedCount} non-owner members for org ${organizationId} due to 0 limit.`);
      // }
      return
    }
    try {
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.OrganizationMember)
        .where(
          and(
            eq(schema.OrganizationMember.organizationId, organizationId),
            eq(schema.OrganizationMember.status, OrganizationMemberStatus.ACTIVE)
          )
        )
      const currentActiveMembers = count
      const membersToDeactivateCount = currentActiveMembers - limit
      if (membersToDeactivateCount > 0) {
        logger.info(
          `Member enforcement: Org ${organizationId} has ${currentActiveMembers} active members, limit is ${limit}. Deactivating ${membersToDeactivateCount}.`
        )
        // Find members to deactivate (Prioritize USERs, then ADMINs if needed, never OWNER)
        const membersToDeactivate = await this.db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.organizationId, organizationId),
              eq(schema.OrganizationMember.status, OrganizationMemberStatus.ACTIVE),
              ne(schema.OrganizationMember.role, OrganizationRole.OWNER) // Never deactivate OWNER
            )
          )
          .orderBy(
            desc(schema.OrganizationMember.role), // Deactivate USERs first, then ADMINs
            desc(schema.OrganizationMember.createdAt) // Deactivate newest within role first
          )
          .limit(membersToDeactivateCount)
        const idsToDeactivate = membersToDeactivate.map((m) => m.id)
        if (idsToDeactivate.length > 0) {
          const result = await this.db
            .update(schema.OrganizationMember)
            .set({ status: OrganizationMemberStatus.INACTIVE })
            .where(inArray(schema.OrganizationMember.id, idsToDeactivate))
          logger.info(
            `Member enforcement: Deactivated ${idsToDeactivate.length} members for org ${organizationId}.`,
            { ids: idsToDeactivate }
          )
        } else {
          logger.warn(
            `Member enforcement: Needed to deactivate ${membersToDeactivateCount} members for org ${organizationId}, but found no eligible members (excluding owner).`,
            { currentActiveMembers, limit }
          )
        }
      } else {
        logger.debug(
          `Member enforcement: Org ${organizationId} is within member limit (${currentActiveMembers}/${limit}).`
        )
      }
    } catch (error: any) {
      logger.error(`Member enforcement: Failed for org ${organizationId}`, { error: error.message })
      // Continue to other enforcement types
    }
  }
  /**
   * Enforces the rule limit based on the current plan.
   * Placeholder - Implement specific logic (disable, delete oldest, etc.).
   */
  private async enforceRuleLimit(organizationId: string, featureMap: FeatureMap): Promise<void> {
    const limit = featureMap.get('rules' as FeatureKey) // Assuming 'rules' is a FeatureKey
    if (typeof limit !== 'number' || limit < 0) {
      // Handle 0 limit if needed
      if (limit !== '+')
        logger.debug(
          `Skipping rule limit enforcement for org ${organizationId}: Limit is not numeric or unlimited (${limit}).`
        )
      return
    }
    logger.info(
      `Rule enforcement: Checking limit (${limit}) for org ${organizationId}. (Logic Placeholder)`
    )
    try {
      // 1. Get current active rule count
      // const currentRuleCount = await this.db.rule.count({ where: { organizationId, enabled: true } });
      // 2. Calculate excess
      // const excessRules = currentRuleCount - limit;
      // 3. If excess > 0:
      //    - Find rules to disable/delete (e.g., oldest, lowest priority)
      //    - Perform update/delete operation
      //    - Log action
      // Example (Disabling oldest):
      // if (excessRules > 0) {
      //     const rulesToDisable = await this.db.rule.findMany({
      //         where: { organizationId, enabled: true },
      //         orderBy: { createdAt: 'asc' },
      //         take: excessRules,
      //         select: { id: true }
      //     });
      //     const idsToDisable = rulesToDisable.map(r => r.id);
      //     if (idsToDisable.length > 0) {
      //         const result = await this.db.rule.updateMany({
      //             where: { id: { in: idsToDisable } },
      //             data: { enabled: false } // Or delete
      //         });
      //         logger.info(`Rule enforcement: Disabled ${result.count} rules for org ${organizationId}.`);
      //     }
      // }
    } catch (error: any) {
      logger.error(`Rule enforcement: Failed for org ${organizationId}`, { error: error.message })
    }
  }
  /**
   * Enforces the integration limit based on the current plan.
   * Placeholder - Implement specific logic (disable, delete oldest, etc.).
   */
  private async enforceIntegrationLimit(
    organizationId: string,
    featureMap: FeatureMap
  ): Promise<void> {
    const limit = featureMap.get('integrations' as FeatureKey) // Assuming 'integrations' is a FeatureKey
    if (typeof limit !== 'number' || limit < 0) {
      if (limit !== '+')
        logger.debug(
          `Skipping integration limit enforcement for org ${organizationId}: Limit is not numeric or unlimited (${limit}).`
        )
      return
    }
    logger.info(
      `Integration enforcement: Checking limit (${limit}) for org ${organizationId}. (Logic Placeholder)`
    )
    try {
      // 1. Get current active integration count (depends on your schema)
      // const currentIntegrationCount = await this.db.integration.count({ where: { organizationId, status: 'ACTIVE' } });
      // 2. Calculate excess
      // const excessIntegrations = currentIntegrationCount - limit;
      // 3. If excess > 0:
      //    - Find integrations to disable/delete (e.g., non-essential ones, oldest)
      //    - Perform update/delete operation
      //    - Log action
    } catch (error: any) {
      logger.error(`Integration enforcement: Failed for org ${organizationId}`, {
        error: error.message,
      })
    }
  }
}
// Helper for locking (example using Redis) - Implement robustly if needed
// async function acquireLock(redis: Redis, key: string, ttl: number): Promise<boolean> {
//     const result = await redis.set(key, 'locked', 'PX', ttl, 'NX');
//     return result === 'OK';
// }
// async function releaseLock(redis: Redis, key: string): Promise<void> {
//     await redis.del(key);
// }

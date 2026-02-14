// packages/lib/src/permissions/feature-permission-service.ts
import { type Database, database as ddb, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '../logger'
import type { FeatureDefinition, FeatureLimit, FeatureMapObject } from './types'
import { DEFAULT_FREE_PLAN_FEATURES, type FeatureKey } from './types'

const logger = createScopedLogger('feature-permission-service')

// Define a type for the parsed feature map
export type FeatureMap = Map<string, FeatureLimit>

const mapToObject = (map: Map<string, FeatureLimit> | null): FeatureMapObject => {
  if (!map) return null
  const obj: Record<string, FeatureLimit> = {}
  map.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}

export class FeaturePermissionService {
  /** Injected Drizzle database connection */
  private db: Database
  private cachePrefix = 'feature-perms:'
  private cacheTTL = 3600 // 1 hour in seconds

  constructor(db?: unknown) {
    // Accept either an injected Drizzle db or fall back to the default singleton
    this.db = db && typeof (db as any).select === 'function' ? (db as Database) : (ddb as Database)
  }

  async getOrganizationFeaturesMap(organizationId: string): Promise<FeatureMap | null> {
    const features = await this.getOrganizationFeatures(organizationId)
    if (!features) return null
    return mapToObject(features)
  }

  /**
   * Gets the feature map (key -> limit) for a given organization.
   * Uses Redis caching with fallback to database.
   * @param organizationId The ID of the organization.
   * @returns A Map of feature keys to their limits, or null if an error occurs.
   */
  async getOrganizationFeatures(organizationId: string): Promise<FeatureMap | null> {
    const cacheKey = `${this.cachePrefix}${organizationId}`

    try {
      // Get Redis client (non-required, won't fail if Redis unavailable)
      const redis = await getRedisClient(false)

      // 1. Check cache if Redis is available
      if (redis) {
        try {
          const cachedData = await redis.get(cacheKey)
          if (cachedData) {
            logger.debug(`Cache hit for organization ${organizationId}`)
            const parsedMap = new Map(Object.entries(JSON.parse(cachedData))) as FeatureMap
            return parsedMap
          }
          logger.debug(`Cache miss for organization ${organizationId}`)
        } catch (error) {
          logger.warn('Redis error when fetching cached features', {
            organizationId,
            error: (error as Error).message,
          })
          // Continue to DB lookup on Redis error
        }
      }

      // 2. Fetch from DB on cache miss or Redis unavailable (Drizzle)
      const [subscription] = await this.db
        .select({
          status: schema.PlanSubscription.status,
          hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
          planId: schema.PlanSubscription.planId,
          customFeatureLimits: schema.PlanSubscription.customFeatureLimits,
        })
        .from(schema.PlanSubscription)
        .where(eq(schema.PlanSubscription.organizationId, organizationId))
        .limit(1)

      let featureDefinitions: FeatureDefinition[] = DEFAULT_FREE_PLAN_FEATURES // Default to free plan

      if (subscription?.planId) {
        const [plan] = await this.db
          .select({ featureLimits: schema.Plan.featureLimits })
          .from(schema.Plan)
          .where(eq(schema.Plan.id, subscription.planId))
          .limit(1)
        const limitsSource = plan?.featureLimits

        // Use trial plan if active, otherwise active plan
        if (subscription.status === 'trialing' && !subscription.hasTrialEnded) {
          logger.info(`Using trial plan features for org ${organizationId}`)
          // Note: Ensure trial plan features are correctly defined in the Plan model
          featureDefinitions = this.parseFeaturesFromJson(limitsSource)
        } else if (subscription.status === 'active') {
          logger.info(`Using active plan features for org ${organizationId}`)
          featureDefinitions = this.parseFeaturesFromJson(limitsSource)
        } else {
          logger.warn(
            `Subscription for org ${organizationId} is not active or trialing (status: ${subscription.status}). Falling back to default.`
          )
          // Fallback to default if status is CANCELED, PAST_DUE etc.
        }
      } else {
        logger.info(
          `No active subscription found for org ${organizationId}. Using default free features.`
        )
      }

      // 3. Convert definitions to Map
      const featureMap = this.createMapFromDefinitions(featureDefinitions)

      // 4. Apply custom feature limits if present (for Enterprise customers)
      if (subscription?.customFeatureLimits) {
        try {
          const customLimits =
            typeof subscription.customFeatureLimits === 'string'
              ? JSON.parse(subscription.customFeatureLimits)
              : subscription.customFeatureLimits

          if (customLimits && typeof customLimits === 'object') {
            logger.info(`Applying custom feature limits for org ${organizationId}`)
            Object.entries(customLimits).forEach(([key, limit]) => {
              if (typeof limit === 'number') {
                // Convert -1 to '+' for unlimited, otherwise use the number
                featureMap.set(key, limit === -1 ? '+' : limit)
              }
            })
          }
        } catch (error) {
          logger.warn('Failed to parse custom feature limits', {
            organizationId,
            error: (error as Error).message,
          })
        }
      }

      // 5. Store in cache if Redis is available
      if (redis) {
        try {
          // Use Map -> Object -> JSON string for storage
          await redis.set(
            cacheKey,
            JSON.stringify(Object.fromEntries(featureMap)),
            'EX',
            this.cacheTTL
          )
          logger.debug(`Stored features in cache for organization ${organizationId}`)
        } catch (error) {
          logger.warn('Redis error when storing features', {
            organizationId,
            error: (error as Error).message,
          })
          // Continue even if caching fails
        }
      }

      return featureMap
    } catch (error) {
      logger.error('Error fetching organization features', {
        organizationId,
        error: (error as Error).message,
      })
      return null // Return null on error to indicate failure
    }
  }

  /**
   * Checks if an organization has access to a specific feature.
   * @param organizationId The organization ID.
   * @param featureKey The feature key (enum or string).
   * @returns True if access is granted, false otherwise.
   */
  async hasAccess(organizationId: string, featureKey: FeatureKey | string): Promise<boolean> {
    const features = await this.getOrganizationFeatures(organizationId)
    if (!features) return false // Default to no access on error

    const limit = features.get(featureKey)

    if (limit === undefined || limit === false || limit === 0) {
      return false
    }
    // Access granted if true, '+', or a number > 0
    return true
  }

  /**
   * Gets the limit for a specific feature for an organization.
   * @param organizationId The organization ID.
   * @param featureKey The feature key (enum or string).
   * @returns The limit ('+', number, true) or null if no access or error.
   */
  async getLimit(
    organizationId: string,
    featureKey: FeatureKey | string
  ): Promise<FeatureLimit | null> {
    const features = await this.getOrganizationFeatures(organizationId)
    if (!features) return null

    const limit = features.get(featureKey)

    // Return null if feature doesn't exist, is explicitly false, or limit is 0
    if (limit === undefined || limit === false || limit === 0) {
      return null
    }

    return limit
  }

  /**
   * Checks if the current usage is within the allowed limit for a feature.
   * @param organizationId The organization ID.
   * @param featureKey The feature key (enum or string).
   * @param currentUsage The current number of items used for this feature.
   * @returns True if usage is within limits, false otherwise.
   */
  async checkLimit(
    organizationId: string,
    featureKey: FeatureKey | string,
    currentUsage: number
  ): Promise<boolean> {
    const limit = await this.getLimit(organizationId, featureKey)

    if (limit === null || limit === false) {
      return false // No access or limit is 0
    }
    if (limit === '+') {
      return true // Unlimited access
    }
    if (typeof limit === 'number') {
      return currentUsage < limit // Check against numeric limit (use <= if limit means 'up to')
    }
    if (limit === true) {
      // For boolean features, checkLimit might mean "is the feature on?"
      // If currentUsage > 0 implies they are trying to use it, allow if true.
      // Or, maybe checkLimit isn't applicable to boolean features. Adjust as needed.
      return true
    }

    return false // Should not happen with current types, but default to false
  }

  /**
   * Invalidates the Redis cache for a specific organization's features.
   * @param organizationId The organization ID.
   */
  async invalidateCache(organizationId: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${organizationId}`
    try {
      const redis = await getRedisClient(false)
      if (!redis) {
        logger.debug(`Redis unavailable, skipping cache invalidation for ${organizationId}`)
        return
      }

      await redis.del(cacheKey)
      logger.info(`Invalidated feature cache for organization ${organizationId}`)
    } catch (error) {
      logger.warn('Error invalidating feature cache', {
        organizationId,
        cacheKey,
        error: (error as Error).message,
      })
      // Continue without error propagation
    }
  }

  // --- Helper Methods ---

  /**
   * Safely parses the features JSON from the Plan model.
   * @param featuresJson The JSON value from Plan.features.
   * @returns An array of FeatureDefinition, or default features if parsing fails or input is invalid.
   */
  private parseFeaturesFromJson(featuresJson: any): FeatureDefinition[] {
    if (!featuresJson) {
      logger.warn('Plan features JSON is null or empty, using default.')
      return DEFAULT_FREE_PLAN_FEATURES
    }

    try {
      const parsed = typeof featuresJson === 'string' ? JSON.parse(featuresJson) : featuresJson
      if (Array.isArray(parsed)) {
        // Basic validation could be added here to ensure items match FeatureDefinition structure
        return parsed as FeatureDefinition[]
      } else {
        logger.warn('Parsed plan features is not an array, using default.', { parsed })
        return DEFAULT_FREE_PLAN_FEATURES
      }
    } catch (error) {
      logger.error('Failed to parse Plan features JSON, using default.', { error })
      return DEFAULT_FREE_PLAN_FEATURES
    }
  }

  /**
   * Converts an array of FeatureDefinition into a Map.
   * @param definitions Array of feature definitions.
   * @returns A Map where keys are feature keys and values are limits.
   */
  private createMapFromDefinitions(definitions: FeatureDefinition[]): FeatureMap {
    const map: FeatureMap = new Map()
    if (!definitions) return map

    definitions.forEach((def) => {
      if (def && typeof def.key === 'string') {
        // Convert -1 to '+' for unlimited, matching customFeatureLimits behavior
        const limit = def.limit === -1 ? '+' : def.limit
        map.set(def.key, limit)
      } else {
        logger.warn('Invalid feature definition skipped', { definition: def })
      }
    })
    return map
  }
}

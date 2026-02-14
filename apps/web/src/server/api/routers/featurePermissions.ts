// src/server/api/routers/featurePermissions.ts (New File or add to existing)

import { getUserOrganizationId } from '@auxx/lib/email' // Ensure this path is correct
import { FeaturePermissionService } from '@auxx/lib/permissions'
import type { FeatureKey } from '@auxx/lib/types'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('featurePermissions-router')

// Helper to convert Map to a plain object for JSON serialization
// (Could also live in a utils file)

// --- How to instantiate the service? ---
// Option 1: Instantiate directly (requires getting Redis instance here)
// import { getRedisClient } from '@auxx/redis'; // Redis client from standalone package
// const featureService = new FeaturePermissionService(ctx.db);

// Option 2: Instantiate per request using context (if Redis is in context)
// Inside procedures: const featureService = new FeaturePermissionService(ctx.db, ctx.redis);

// Choose the method that fits your project structure best. Using context is common.

export const featurePermissionsRouter = createTRPCRouter({
  /**
   * Get all feature flags and limits for the current organization.
   * Intended for client-side context provider.
   */
  getAllFeatures: protectedProcedure.query(async ({ ctx }) => {
    // console.log(ctx.session)
    const organizationId = getUserOrganizationId(ctx.session)
    if (!organizationId) {
      logger.warn('getAllFeatures: Organization ID not found in session.')
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
    }

    try {
      const featureService = new FeaturePermissionService(ctx.db)

      const featuresMap = await featureService.getOrganizationFeaturesMap(organizationId)
      logger.info('Fetched all feature flags', { featuresMap })
      return featuresMap
      // Convert Map to plain object for tRPC/JSON
      // return mapToObject(featuresMap)
    } catch (error: any) {
      logger.error('Error fetching all feature flags', { organizationId, error: error.message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch feature permissions.',
      })
    }
  }),

  /**
   * Check access for a single feature (useful for server-side checks).
   */
  hasAccess: protectedProcedure
    .input(
      z.object({
        // Use z.string() if you don't want strict enum checking,
        // or z.enum(FeatureKey) for stricter validation.
        featureKey: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      const featureService = new FeaturePermissionService(ctx.db)
      const key = input.featureKey as FeatureKey | string // Cast needed if using z.string()
      return featureService.hasAccess(organizationId, key)
    }),

  /**
   * Get the limit for a single feature (useful for server-side checks).
   */
  getLimit: protectedProcedure
    .input(z.object({ featureKey: z.string() }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      const featureService = new FeaturePermissionService(ctx.db)
      const key = input.featureKey as FeatureKey | string
      return featureService.getLimit(organizationId, key)
    }),

  /**
   * Check if usage is within limit for a single feature (useful for server-side checks).
   */
  checkLimit: protectedProcedure
    .input(z.object({ featureKey: z.string(), currentUsage: z.number().min(0) }))
    .query(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) throw new TRPCError({ code: 'UNAUTHORIZED' })

      const featureService = new FeaturePermissionService(ctx.db)
      const key = input.featureKey as FeatureKey | string
      return featureService.checkLimit(organizationId, key, input.currentUsage)
    }),
})

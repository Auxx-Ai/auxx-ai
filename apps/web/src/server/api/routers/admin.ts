// apps/web/src/server/api/routers/admin.ts

import { AdminBillingService, PlanAdminService, PlanService } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { schema } from '@auxx/database'
import { AdminService } from '@auxx/lib/admin'
import {
  flushOrganization,
  getAppCache,
  getOrgCache,
  getUserCache,
  onCacheEvent,
} from '@auxx/lib/cache'
import { FeatureKey, FeaturePermissionService, handlePlanDowngrade } from '@auxx/lib/permissions'
import { createUsageGuard, type UsageMetric, type UsageStatus } from '@auxx/lib/usage'
import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'
import { adminAppsRouter } from './admin-apps'
import { adminHealthRouter } from './admin-health'
import { adminWorkflowTemplatesRouter } from './admin-workflow-templates'

/**
 * Admin router for super admin operations
 */
export const adminRouter = createTRPCRouter({
  /**
   * Get organizations with metrics
   */
  getOrganizations: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getOrganizations(input)
    }),

  /**
   * Get single organization details
   */
  getOrganization: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getOrganization(input.id)
    }),

  /**
   * Delete organization
   */
  deleteOrganization: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.deleteOrganization(input.id)
      await flushOrganization(input.id)
      return { success: true }
    }),

  /**
   * Get organization members
   */
  getOrganizationMembers: superAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getOrganizationMembers(input.organizationId)
    }),

  /**
   * Get users with metrics (non-system users only)
   */
  getUsers: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        search: z.string().optional(),
        organizationId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUsers(input)
    }),

  /**
   * Get single user details
   */
  getUser: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getUser(input.id)
    }),

  /**
   * Delete user (non-system users only)
   */
  deleteUser: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.deleteUser(input.id)
      await getUserCache().invalidateUser(input.id)
      return { success: true }
    }),

  /**
   * Verify user email
   */
  verifyUserEmail: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.verifyUserEmail(input.id)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Send password reset email to user
   */
  sendPasswordReset: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      const user = await adminService.getUser(input.id)
      if (!user?.email) {
        throw new Error('User not found or has no email')
      }
      const { auth } = await import('~/auth/server')
      await auth.api.requestPasswordReset({
        body: { email: user.email, redirectTo: '/reset-password' },
      })
      return { success: true }
    }),

  /**
   * Revoke all user sessions
   */
  revokeUserSessions: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.revokeAllSessions(input.id)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Disable user two-factor authentication
   */
  disableUserTwoFactor: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.disableTwoFactor(input.id)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Force user to change password on next login
   */
  forceUserPasswordChange: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.forcePasswordChange(input.id)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Ban or unban a user account
   */
  setUserBanned: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        banned: z.boolean(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.setUserBanned(input.id, input.banned, input.reason)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Update user super admin status
   */
  setUserSuperAdmin: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        isSuperAdmin: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.setUserSuperAdmin(input.id, input.isSuperAdmin)
      await getUserCache().invalidateAndRecompute(input.id, ['userProfile'])
      return { success: true }
    }),

  /**
   * Get all available plans
   */
  getPlans: superAdminProcedure.query(async ({ ctx }) => {
    const planService = new PlanService(ctx.db)
    return planService.getPlans()
  }),

  /**
   * Change organization plan
   */
  changePlan: superAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        planName: z.string(),
        billingCycle: z.enum(['MONTHLY', 'ANNUAL']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { schema } = await import('@auxx/database')
      const { eq } = await import('drizzle-orm')

      // Get the plan by name (getPlans returns lowercased names)
      const planService = new PlanService(ctx.db)
      const plans = await planService.getPlans()
      const plan = plans.find((p) => p.name === input.planName.toLowerCase())

      if (!plan) {
        throw new Error(`Plan ${input.planName} not found`)
      }

      // Prepare update data
      const updateData: any = {
        planId: plan.id,
        plan: input.planName,
        updatedAt: new Date(),
      }

      // Add billing cycle if provided
      if (input.billingCycle) {
        updateData.billingCycle = input.billingCycle
      }

      // Update the subscription
      await ctx.db
        .update(schema.PlanSubscription)
        .set(updateData)
        .where(eq(schema.PlanSubscription.organizationId, input.organizationId))

      // Invalidate cached feature permissions and dehydrated state
      await onCacheEvent('plan.changed', { orgId: input.organizationId })

      return { success: true }
    }),

  /**
   * Seed organization with demo data
   */
  seedOrganization: superAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        mode: z.enum(['reset', 'additive']),
        scenario: z
          .enum(['demo', 'development', 'testing', 'superadmin-test'])
          .optional()
          .default('demo'),
      })
    )
    .mutation(async ({ input }) => {
      const { OrganizationSeeder } = await import('@auxx/seed')
      await OrganizationSeeder.seedOrganization(input.organizationId, input.mode, input.scenario)
      await flushOrganization(input.organizationId)

      return {
        success: true,
        message: `Organization ${input.mode === 'reset' ? 'reset and' : ''} seeded successfully (${input.scenario})`,
      }
    }),

  /**
   * Get usage status for a single organization (detail page)
   */
  getOrganizationUsage: superAdminProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const ALL_METRICS: UsageMetric[] = [
        'outboundEmails',
        'workflowRuns',
        'aiCompletions',
        'apiCalls',
      ]

      const guard = await createUsageGuard(ctx.db)
      let metrics: UsageStatus[]
      if (guard) {
        metrics = await Promise.all(ALL_METRICS.map((m) => guard.check(input.organizationId, m)))
      } else {
        metrics = ALL_METRICS.map((m) => ({
          metric: m,
          current: 0,
          hardLimit: 0,
          softLimit: 0,
          unlimited: true,
          percentUsed: 0,
        }))
      }

      // Storage — uses FeaturePermissionService for the limit and calculates current from DB
      const featureService = new FeaturePermissionService(ctx.db)
      const storageLimitRaw = await featureService.getLimit(
        input.organizationId,
        FeatureKey.storageGbHard
      )
      const { calculateStorageUsage } = await import('@auxx/lib/files/lifecycle/quota-cleanup')
      const storageQuota = await calculateStorageUsage(input.organizationId)

      const limitGb =
        storageLimitRaw === '+'
          ? null
          : typeof storageLimitRaw === 'number'
            ? storageLimitRaw
            : null
      const currentGb = Number((storageQuota.totalUsed / (1024 * 1024 * 1024)).toFixed(2))
      const storagePercentUsed = limitGb ? Math.round((currentGb / limitGb) * 100) : 0

      return {
        metrics,
        storage: { currentGb, limitGb, percentUsed: storagePercentUsed },
      }
    }),

  /**
   * Get lightweight usage summary for multiple organizations (list page)
   */
  getOrganizationsUsageSummary: superAdminProcedure
    .input(z.object({ organizationIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const ALL_METRICS: UsageMetric[] = [
        'outboundEmails',
        'workflowRuns',
        'aiCompletions',
        'apiCalls',
      ]

      const guard = await createUsageGuard(ctx.db)
      if (!guard) {
        return input.organizationIds.map((orgId) => ({
          organizationId: orgId,
          maxPercentUsed: 0,
          allUnlimited: true,
        }))
      }

      const statusMap = await guard.checkBatch(input.organizationIds, ALL_METRICS)
      const results = input.organizationIds.map((orgId) => {
        const statuses = ALL_METRICS.map((m) => statusMap.get(`${orgId}:${m}`)!)
        const allUnlimited = statuses.every((s) => s.unlimited)
        const maxPercentUsed = allUnlimited ? 0 : Math.max(...statuses.map((s) => s.percentUsed))
        return { organizationId: orgId, maxPercentUsed, allUnlimited }
      })
      return results
    }),

  /**
   * Billing management router for admin billing actions
   */
  billing: createTRPCRouter({
    // ========== Trial Management ==========

    /**
     * End trial immediately
     */
    endTrial: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.endTrialImmediately({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Extend trial period
     */
    extendTrial: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          newEndDate: z.date(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.extendTrial({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Convert trial to paid
     */
    convertTrialToPaid: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          planName: z.string().optional(),
          skipPayment: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.convertTrialToPaid({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    // ========== Organization Access ==========

    /**
     * Disable organization access
     */
    disableOrganization: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          reason: z.string().min(10, 'Reason must be at least 10 characters'),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.disableOrganization({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('org.updated', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Enable organization access
     */
    enableOrganization: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.enableOrganization({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('org.updated', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Cancel scheduled deletion
     */
    cancelScheduledDeletion: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.cancelScheduledDeletion({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    // ========== Subscription Management ==========

    /**
     * Create subscription for an organization that doesn't have one
     */
    createSubscription: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          planName: z.string(),
          billingCycle: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
          status: z.string().default('active'),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify org exists
        const org = await ctx.db
          .select({ id: schema.Organization.id })
          .from(schema.Organization)
          .where(eq(schema.Organization.id, input.organizationId))
          .then((rows) => rows[0])

        if (!org) {
          throw new Error('Organization not found')
        }

        // Check no subscription already exists
        const existing = await ctx.db
          .select({ id: schema.PlanSubscription.id })
          .from(schema.PlanSubscription)
          .where(eq(schema.PlanSubscription.organizationId, input.organizationId))
          .then((rows) => rows[0])

        if (existing) {
          throw new Error('Organization already has a subscription')
        }

        // Resolve plan
        const planService = new PlanService(ctx.db)
        const plans = await planService.getPlans()
        const plan = plans.find((p) => p.name === input.planName.toLowerCase())

        if (!plan) {
          throw new Error(`Plan ${input.planName} not found`)
        }

        // Insert subscription
        await ctx.db.insert(schema.PlanSubscription).values({
          organizationId: input.organizationId,
          planId: plan.id,
          plan: input.planName,
          status: input.status,
          billingCycle: input.billingCycle,
          seats: 1,
          periodStart: new Date(),
        })

        await onCacheEvent('plan.changed', { orgId: input.organizationId })

        return { success: true }
      }),

    /**
     * Cancel subscription immediately
     */
    cancelImmediately: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.cancelSubscriptionImmediately({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.canceled', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Reactivate canceled subscription
     */
    reactivateSubscription: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.reactivateCanceledSubscription({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Force subscription status change
     */
    forceStatusChange: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          newStatus: z.string(),
          reason: z.string().min(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.forceStatusChange({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    // ========== Enterprise Management ==========

    /**
     * Set organization to Enterprise plan
     */
    setEnterprisePlan: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          copyCurrentLimits: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.setEnterprisePlan({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Configure custom feature limits
     */
    configureCustomLimits: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          limits: z.record(z.string(), z.union([z.number(), z.boolean()])),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.configureCustomFeatureLimits({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    /**
     * Clear custom feature limits
     */
    clearCustomLimits: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.clearCustomFeatureLimits({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    // ========== Financial Actions ==========

    /**
     * Apply credit adjustment
     */
    applyCreditAdjustment: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          amount: z.number(),
          reason: z.string().min(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, WEBAPP_URL, handlePlanDowngrade)
        await service.applyCreditAdjustment({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        await onCacheEvent('plan.changed', { orgId: input.organizationId })
        return { success: true }
      }),

    // ========== Query Actions ==========

    /**
     * Get admin action history for organization
     */
    getActionHistory: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          limit: z.number().default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const { schema } = await import('@auxx/database')
        const { eq, desc } = await import('drizzle-orm')

        // Query logs with manual join to User table
        const logs = await ctx.db
          .select({
            id: schema.AdminActionLog.id,
            adminUserId: schema.AdminActionLog.adminUserId,
            actionType: schema.AdminActionLog.actionType,
            targetType: schema.AdminActionLog.targetType,
            targetId: schema.AdminActionLog.targetId,
            organizationId: schema.AdminActionLog.organizationId,
            details: schema.AdminActionLog.details,
            reason: schema.AdminActionLog.reason,
            previousState: schema.AdminActionLog.previousState,
            newState: schema.AdminActionLog.newState,
            ipAddress: schema.AdminActionLog.ipAddress,
            userAgent: schema.AdminActionLog.userAgent,
            createdAt: schema.AdminActionLog.createdAt,
            adminUser: {
              id: schema.User.id,
              name: schema.User.name,
              email: schema.User.email,
            },
          })
          .from(schema.AdminActionLog)
          .leftJoin(schema.User, eq(schema.AdminActionLog.adminUserId, schema.User.id))
          .where(eq(schema.AdminActionLog.organizationId, input.organizationId))
          .orderBy(desc(schema.AdminActionLog.createdAt))
          .limit(input.limit)

        return logs
      }),

    /**
     * Get feature limits for organization
     */
    getFeatureLimits: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .query(async ({ ctx, input }) => {
        const { schema } = await import('@auxx/database')
        const { eq } = await import('drizzle-orm')

        // Query subscription with plan using manual join
        const [result] = await ctx.db
          .select({
            customFeatureLimits: schema.PlanSubscription.customFeatureLimits,
            planFeatureLimits: schema.Plan.featureLimits,
          })
          .from(schema.PlanSubscription)
          .leftJoin(schema.Plan, eq(schema.PlanSubscription.planId, schema.Plan.id))
          .where(eq(schema.PlanSubscription.organizationId, input.organizationId))
          .limit(1)

        return {
          planDefaults: result?.planFeatureLimits || {},
          customOverrides: result?.customFeatureLimits || {},
          effectiveLimits: {
            ...(result?.planFeatureLimits || {}),
            ...(result?.customFeatureLimits || {}),
          },
        }
      }),
  }),

  /**
   * Get developer accounts with app/member counts
   */
  getDeveloperAccounts: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { limit = 100, offset = 0, search } = input

      const conditions = search
        ? or(
            ilike(schema.DeveloperAccount.title, `%${search}%`),
            ilike(schema.DeveloperAccount.slug, `%${search}%`)
          )
        : undefined

      const accounts = await ctx.db
        .select({
          id: schema.DeveloperAccount.id,
          slug: schema.DeveloperAccount.slug,
          title: schema.DeveloperAccount.title,
          logoUrl: schema.DeveloperAccount.logoUrl,
          createdAt: schema.DeveloperAccount.createdAt,
          appCount: sql<number>`cast(count(distinct ${schema.App.id}) as int)`,
          memberCount: sql<number>`cast(count(distinct ${schema.DeveloperAccountMember.id}) as int)`,
        })
        .from(schema.DeveloperAccount)
        .leftJoin(schema.App, eq(schema.App.developerAccountId, schema.DeveloperAccount.id))
        .leftJoin(
          schema.DeveloperAccountMember,
          eq(schema.DeveloperAccountMember.developerAccountId, schema.DeveloperAccount.id)
        )
        .where(conditions)
        .groupBy(schema.DeveloperAccount.id)
        .orderBy(schema.DeveloperAccount.createdAt)
        .limit(limit)
        .offset(offset)

      return accounts
    }),

  /**
   * Get a single developer account with app/member counts
   */
  getDeveloperAccount: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [account] = await ctx.db
        .select({
          id: schema.DeveloperAccount.id,
          slug: schema.DeveloperAccount.slug,
          title: schema.DeveloperAccount.title,
          logoUrl: schema.DeveloperAccount.logoUrl,
          createdAt: schema.DeveloperAccount.createdAt,
          appCount: sql<number>`cast(count(distinct ${schema.App.id}) as int)`,
          memberCount: sql<number>`cast(count(distinct ${schema.DeveloperAccountMember.id}) as int)`,
        })
        .from(schema.DeveloperAccount)
        .leftJoin(schema.App, eq(schema.App.developerAccountId, schema.DeveloperAccount.id))
        .leftJoin(
          schema.DeveloperAccountMember,
          eq(schema.DeveloperAccountMember.developerAccountId, schema.DeveloperAccount.id)
        )
        .where(eq(schema.DeveloperAccount.id, input.id))
        .groupBy(schema.DeveloperAccount.id)
        .limit(1)

      return account ?? null
    }),

  /**
   * Get members of a developer account
   */
  getDeveloperAccountMembers: superAdminProcedure
    .input(z.object({ developerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.db
        .select({
          id: schema.DeveloperAccountMember.id,
          userId: schema.DeveloperAccountMember.userId,
          emailAddress: schema.DeveloperAccountMember.emailAddress,
          accessLevel: schema.DeveloperAccountMember.accessLevel,
        })
        .from(schema.DeveloperAccountMember)
        .where(eq(schema.DeveloperAccountMember.developerAccountId, input.developerAccountId))
        .orderBy(schema.DeveloperAccountMember.createdAt)

      return members
    }),

  /**
   * Add a member to a developer account by email
   */
  addDeveloperAccountMember: superAdminProcedure
    .input(
      z.object({
        developerAccountId: z.string(),
        emailAddress: z.string().email(),
        accessLevel: z.enum(['admin', 'member']).default('member'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db
        .select({ id: schema.User.id, email: schema.User.email })
        .from(schema.User)
        .where(eq(schema.User.email, input.emailAddress))
        .limit(1)
        .then((rows) => rows[0])

      if (!user) {
        throw new Error('No user found with that email address')
      }

      const existing = await ctx.db
        .select({ id: schema.DeveloperAccountMember.id })
        .from(schema.DeveloperAccountMember)
        .where(
          and(
            eq(schema.DeveloperAccountMember.developerAccountId, input.developerAccountId),
            eq(schema.DeveloperAccountMember.userId, user.id)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (existing) {
        throw new Error('User is already a member of this developer account')
      }

      const [member] = await ctx.db
        .insert(schema.DeveloperAccountMember)
        .values({
          developerAccountId: input.developerAccountId,
          userId: user.id,
          emailAddress: input.emailAddress,
          accessLevel: input.accessLevel,
        })
        .returning()

      // Invalidate build cache for the newly added user and all existing members
      await onCacheEvent('build.developer-account.member-added', {
        userId: user.id,
        developerAccountId: input.developerAccountId,
      })

      return member
    }),

  /**
   * Remove a member from a developer account
   */
  removeDeveloperAccountMember: superAdminProcedure
    .input(z.object({ memberId: z.string(), developerAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get the member's userId before deleting for cache invalidation
      const member = await ctx.db
        .select({ userId: schema.DeveloperAccountMember.userId })
        .from(schema.DeveloperAccountMember)
        .where(eq(schema.DeveloperAccountMember.id, input.memberId))
        .limit(1)
        .then((rows) => rows[0])

      await ctx.db
        .delete(schema.DeveloperAccountMember)
        .where(eq(schema.DeveloperAccountMember.id, input.memberId))

      // Invalidate build cache for the removed user and all remaining members
      await onCacheEvent('build.developer-account.member-removed', {
        userId: member?.userId,
        developerAccountId: input.developerAccountId,
      })
    }),

  /**
   * Apps management router
   */
  apps: adminAppsRouter,

  /**
   * Health monitoring router
   */
  health: adminHealthRouter,

  /**
   * Workflow templates management router
   */
  workflowTemplates: adminWorkflowTemplatesRouter,

  /**
   * Plans management router for admin plan CRUD operations
   */
  plans: createTRPCRouter({
    /**
     * Get all plans with optional filters
     */
    getAll: superAdminProcedure
      .input(
        z.object({
          includeLegacy: z.boolean().optional(),
          search: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.getAllPlans(input)
      }),

    /**
     * Get plan by ID
     */
    getById: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.getPlanById(input.id)
      }),

    /**
     * Create new plan
     */
    create: superAdminProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          description: z.string().min(1).max(500),
          features: z.array(z.string()),
          monthlyPrice: z.number().int().min(0),
          annualPrice: z.number().int().min(0),
          isCustomPricing: z.boolean(),
          isFree: z.boolean(),
          hasTrial: z.boolean(),
          trialDays: z.number().int().min(0).max(365),
          featureLimits: z.array(
            z.object({
              key: z.string(),
              limit: z.union([z.number().int(), z.boolean()]),
            })
          ),
          hierarchyLevel: z.number().int().min(0).max(10),
          selfServed: z.boolean(),
          isMostPopular: z.boolean(),
          minSeats: z.number().int().min(1).optional(),
          maxSeats: z.number().int().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        const plan = await service.createPlan(input)
        await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
        return plan
      }),

    /**
     * Update existing plan
     */
    update: superAdminProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().min(1).max(500).optional(),
          features: z.array(z.string()).optional(),
          monthlyPrice: z.number().int().min(0).optional(),
          annualPrice: z.number().int().min(0).optional(),
          isCustomPricing: z.boolean().optional(),
          isFree: z.boolean().optional(),
          hasTrial: z.boolean().optional(),
          trialDays: z.number().int().min(0).max(365).optional(),
          featureLimits: z
            .array(
              z.object({
                key: z.string(),
                limit: z.union([z.number().int(), z.boolean()]),
              })
            )
            .optional(),
          hierarchyLevel: z.number().int().min(0).max(10).optional(),
          selfServed: z.boolean().optional(),
          isMostPopular: z.boolean().optional(),
          minSeats: z.number().int().min(1).optional(),
          maxSeats: z.number().int().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        const { id, ...data } = input
        const plan = await service.updatePlan(id, data)
        await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
        return plan
      }),

    /**
     * Update plan pricing
     */
    updatePricing: superAdminProcedure
      .input(
        z.object({
          id: z.string(),
          monthlyPrice: z.number().int().min(0),
          annualPrice: z.number().int().min(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        const { id, ...pricing } = input
        const result = await service.updatePricing(id, pricing)
        await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
        return result
      }),

    /**
     * Mark plan as legacy (soft delete)
     */
    markAsLegacy: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        const result = await service.markAsLegacy(input.id)
        await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
        return result
      }),

    /**
     * Restore legacy plan
     */
    restoreLegacy: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        const result = await service.restoreLegacyPlan(input.id)
        await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
        return result
      }),

    /**
     * Get subscription count for plan
     */
    getSubscriptionCount: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.getSubscriptionCount(input.id)
      }),

    /**
     * Check if plan has active subscriptions
     */
    hasActiveSubscriptions: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.hasActiveSubscriptions(input.id)
      }),

    /**
     * Sync plan to Stripe (create/update product and prices)
     */
    syncToStripe: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.syncToStripe(input.id)
      }),

    /**
     * Seed initial plans (Free, Starter, Growth, Enterprise)
     */
    seedInitialPlans: superAdminProcedure.mutation(async ({ ctx }) => {
      const { BillingDomain, ScenarioBuilder } = await import('@auxx/seed')

      // Use static builder with a valid scenario name
      const scenario = ScenarioBuilder.build('demo')

      // Empty context — BillingDomain requires it but doesn't use it for plan seeding
      const context = {
        auth: {
          testUsers: [],
          randomUsers: [],
          credentials: { message: '', password: '', accounts: [] },
        },
        services: {
          organizations: [],
          integrations: [],
          inboxes: [],
          shopifyIntegrations: [],
        },
      }

      const billingDomain = new BillingDomain(scenario, context, { plansOnly: false })
      const plansCreated = await billingDomain.insertDirectly(ctx.db)
      await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
      await getOrgCache().flushKeyForAllOrgs(['features', 'subscription', 'overages'])

      return {
        success: true,
        plansCreated,
        message: `Successfully seeded ${plansCreated} plans`,
      }
    }),

    /**
     * Update feature limits on existing plans without deleting/recreating them.
     * Safe to run with active subscribers.
     */
    updatePlanFeatureLimits: superAdminProcedure.mutation(async ({ ctx }) => {
      const { BillingDomain, ScenarioBuilder } = await import('@auxx/seed')

      const scenario = ScenarioBuilder.build('demo')
      const context = {
        auth: {
          testUsers: [],
          randomUsers: [],
          credentials: { message: '', password: '', accounts: [] },
        },
        services: {
          organizations: [],
          integrations: [],
          inboxes: [],
          shopifyIntegrations: [],
        },
      }

      const billingDomain = new BillingDomain(scenario, context)
      const plansUpdated = await billingDomain.updateFeatureLimitsOnly(ctx.db)
      await getAppCache().invalidateAndRecompute(['plans', 'planMap'])
      await getOrgCache().flushKeyForAllOrgs(['features', 'subscription', 'overages'])

      return {
        success: true,
        plansUpdated,
        message: `Successfully updated feature limits for ${plansUpdated} plans`,
      }
    }),
  }),
})

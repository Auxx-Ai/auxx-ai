// apps/web/src/server/api/routers/admin.ts

import { AdminBillingService, PlanAdminService, PlanService } from '@auxx/billing'
import { AdminService } from '@auxx/lib/admin'
import { OrganizationSeeder } from '@auxx/seed'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'
import { adminAppsRouter } from './admin-apps'
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

      // Get the plan by name
      const planService = new PlanService(ctx.db)
      const plan = await planService.findPlan({ name: input.planName })

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await OrganizationSeeder.seedOrganization(input.organizationId, input.mode)

      return {
        success: true,
        message: `Organization ${input.mode === 'reset' ? 'reset and' : ''} seeded successfully`,
      }
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.endTrialImmediately({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.extendTrial({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.convertTrialToPaid({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.disableOrganization({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    /**
     * Enable organization access
     */
    enableOrganization: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.enableOrganization({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    /**
     * Cancel scheduled deletion
     */
    cancelScheduledDeletion: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.cancelScheduledDeletion({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    // ========== Subscription Management ==========

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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.cancelSubscriptionImmediately({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    /**
     * Reactivate canceled subscription
     */
    reactivateSubscription: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.reactivateCanceledSubscription({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.forceStatusChange({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.setEnterprisePlan({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    /**
     * Configure custom feature limits
     */
    configureCustomLimits: superAdminProcedure
      .input(
        z.object({
          organizationId: z.string(),
          limits: z.record(z.string(), z.number()),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.configureCustomFeatureLimits({
          ...input,
          adminUserId: ctx.session.user.id,
        })
        return { success: true }
      }),

    /**
     * Clear custom feature limits
     */
    clearCustomLimits: superAdminProcedure
      .input(z.object({ organizationId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.clearCustomFeatureLimits({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
        const service = new AdminBillingService(ctx.db, process.env.NEXT_PUBLIC_BASE_URL!)
        await service.applyCreditAdjustment({
          ...input,
          adminUserId: ctx.session.user.id,
        })
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
   * Apps management router
   */
  apps: adminAppsRouter,

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
              limit: z.number().int(),
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
        return service.createPlan(input)
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
                limit: z.number().int(),
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
        return service.updatePlan(id, data)
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
        return service.updatePricing(id, pricing)
      }),

    /**
     * Mark plan as legacy (soft delete)
     */
    markAsLegacy: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.markAsLegacy(input.id)
      }),

    /**
     * Restore legacy plan
     */
    restoreLegacy: superAdminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const service = new PlanAdminService(ctx.db)
        return service.restoreLegacyPlan(input.id)
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

      return {
        success: true,
        plansCreated,
        message: `Successfully seeded ${plansCreated} plans`,
      }
    }),
  }),
})

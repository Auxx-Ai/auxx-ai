// apps/web/src/server/api/routers/billing.ts

import { BillingPortalService, SubscriptionService, stripeClient } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { getAppCache, getOrgCache, onCacheEvent } from '@auxx/lib/cache'
import { getUserOrganizationId } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('billing-router')

/** Blocks all billing procedures in self-hosted mode */
const cloudOnlyProcedure = protectedProcedure.use(async ({ next }) => {
  if (isSelfHosted()) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Billing is not available in self-hosted mode',
    })
  }
  return next()
})

/** Read the cached subscription for the current org, or null */
async function getCachedSubscription(orgId: string) {
  return getOrgCache().from(orgId, 'subscription').value()
}

export const billingRouter = createTRPCRouter({
  // Get all available plans (cached, non-legacy, ordered by hierarchy)
  getPlans: cloudOnlyProcedure.query(async () => {
    return getAppCache().get('plans')
  }),

  // Get current subscription (cached subscription + plan from app cache)
  getCurrentSubscription: cloudOnlyProcedure.query(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const subscription = await getCachedSubscription(organizationId)
      if (!subscription) return null

      // Enrich with plan data from app cache
      const planMap = await getAppCache().get('planMap')
      const plan = subscription.planId ? (planMap[subscription.planId] ?? null) : null

      return { ...subscription, plan }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error fetching current subscription', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error fetching current subscription: ${message}`,
      })
    }
  }),

  // Get organization invoices
  getInvoices: cloudOnlyProcedure
    .input(
      z.object({ limit: z.number().min(1).max(100).default(10), cursor: z.string().optional() })
    )
    .query(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const { limit, cursor } = input

        let cursorDate: Date | null = null
        if (cursor) {
          const [c] = await ctx.db
            .select({ invoiceDate: schema.Invoice.invoiceDate })
            .from(schema.Invoice)
            .where(eq(schema.Invoice.id, cursor))
            .limit(1)
          cursorDate = c?.invoiceDate ? new Date(c.invoiceDate) : null
        }

        const invoices = await ctx.db
          .select()
          .from(schema.Invoice)
          .where(
            and(
              eq(schema.Invoice.organizationId, organizationId),
              ...(cursorDate ? [lt(schema.Invoice.invoiceDate, cursorDate as any)] : [])
            )
          )
          .orderBy(desc(schema.Invoice.invoiceDate))
          .limit(limit + 1)

        let nextCursor: string | undefined
        if (invoices.length > limit) {
          const nextItem = invoices.pop()
          nextCursor = nextItem?.id
        }

        return { items: invoices, nextCursor }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error fetching invoices', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error fetching invoices: ${message}`,
        })
      }
    }),

  // Check trial status (cached)
  checkTrialStatus: cloudOnlyProcedure.query(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const subscription = await getCachedSubscription(organizationId)

      // If no subscription or not in trial state, return null
      if (!subscription || subscription.status !== 'trialing') {
        return { inTrial: false, subscription }
      }

      // Calculate if trial has expired
      const now = new Date()
      const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null
      const hasExpired = trialEnd ? trialEnd < now : true
      const daysRemaining = trialEnd
        ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0

      return {
        inTrial: !hasExpired,
        subscription,
        daysRemaining,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error checking trial status', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error checking trial status: ${message}`,
      })
    }
  }),

  // Check trial eligibility (cached)
  checkTrialEligibility: cloudOnlyProcedure
    .input(z.object({ planId: z.string() }))
    .query(async ({ ctx }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscription = await getCachedSubscription(organizationId)

        // If no subscription, they're eligible
        if (!subscription) {
          return { isEligible: true, reason: null }
        }

        // If in active trial, not eligible
        if (subscription.status === 'trialing' && !subscription.hasTrialEnded) {
          return { isEligible: false, reason: 'Organization already has an active trial' }
        }

        // Check eligibility flag
        return {
          isEligible: subscription.isEligibleForTrial,
          reason: subscription.isEligibleForTrial ? null : subscription.trialEligibilityReason,
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error checking trial eligibility', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error checking trial eligibility: ${message}`,
        })
      }
    }),

  // Calculate subscription preview (pricing, tax, proration)
  calculateSubscriptionPreview: cloudOnlyProcedure
    .input(
      z.object({
        planName: z.string(),
        billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
        seats: z.number().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscriptionService = new SubscriptionService(ctx.db, WEBAPP_URL)

        return await subscriptionService.calculateSubscriptionPreview({
          organizationId,
          ...input,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error calculating subscription preview', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error calculating subscription preview: ${message}`,
        })
      }
    }),

  // Upgrade/change subscription
  upgradeSubscription: cloudOnlyProcedure
    .input(
      z.object({
        planName: z.string(),
        billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
        seats: z.number().optional(),
        successUrl: z.string(),
        cancelUrl: z.string(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .use(notDemo('manage billing'))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscriptionService = new SubscriptionService(ctx.db, WEBAPP_URL)

        return await subscriptionService.createCheckoutSession(
          {
            organizationId,
            ...input,
          },
          ctx.session.user.email
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''
        logger.error('Error upgrading subscription', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error upgrading subscription: ${message}`,
        })
      }
    }),

  // Cancel subscription
  cancelSubscription: cloudOnlyProcedure
    .use(notDemo('manage billing'))
    .mutation(async ({ ctx }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscriptionService = new SubscriptionService(ctx.db, WEBAPP_URL)

        await subscriptionService.cancelSubscription({
          organizationId,
          returnUrl: '', // No longer needed
        })

        await onCacheEvent('plan.canceled', { orgId: organizationId })

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error canceling subscription', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error canceling subscription: ${message}`,
        })
      }
    }),

  // Restore canceled subscription
  restoreSubscription: cloudOnlyProcedure
    .use(notDemo('manage billing'))
    .mutation(async ({ ctx }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscriptionService = new SubscriptionService(ctx.db, WEBAPP_URL)

        await subscriptionService.restoreSubscription({ organizationId })

        await onCacheEvent('plan.changed', { orgId: organizationId })

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error restoring subscription', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error restoring subscription: ${message}`,
        })
      }
    }),

  // Create billing portal session
  createBillingPortal: cloudOnlyProcedure
    .input(
      z.object({
        returnUrl: z.string(),
        locale: z.string().optional(),
      })
    )
    .use(notDemo('manage billing'))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const portalService = new BillingPortalService(ctx.db, WEBAPP_URL)

        return await portalService.createSession({
          organizationId,
          ...input,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error creating billing portal', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error creating billing portal: ${message}`,
        })
      }
    }),

  // Get billing details from Stripe customer (cached stripeCustomerId)
  getBillingDetails: cloudOnlyProcedure.query(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const subscription = await getCachedSubscription(organizationId)

      if (!subscription?.stripeCustomerId) {
        return null
      }

      const stripe = stripeClient.getClient()
      const customer = await stripe.customers.retrieve(subscription.stripeCustomerId)

      if (customer.deleted) {
        return null
      }

      return {
        email: customer.email || null,
        companyName: customer.name || null,
        address: customer.address || null,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error fetching billing details', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error fetching billing details: ${message}`,
      })
    }
  }),

  // Update billing address in Stripe (cached stripeCustomerId)
  updateBillingAddress: cloudOnlyProcedure
    .input(
      z.object({
        email: z.string().email(),
        companyName: z.string().optional(),
        address: z.object({
          line1: z.string(),
          line2: z.string().optional().nullable(),
          city: z.string(),
          state: z.string().optional().nullable(),
          postalCode: z.string(),
          country: z.string(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscription = await getCachedSubscription(organizationId)

        if (!subscription?.stripeCustomerId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No Stripe customer found' })
        }

        const stripe = stripeClient.getClient()
        await stripe.customers.update(subscription.stripeCustomerId, {
          email: input.email,
          name: input.companyName,
          address: {
            line1: input.address.line1,
            line2: input.address.line2 || undefined,
            city: input.address.city,
            state: input.address.state || undefined,
            postal_code: input.address.postalCode,
            country: input.address.country,
          },
        })

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error updating billing address', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error updating billing address: ${message}`,
        })
      }
    }),

  // Get payment methods from Stripe (cached stripeCustomerId)
  getPaymentMethods: cloudOnlyProcedure.query(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const subscription = await getCachedSubscription(organizationId)

      if (!subscription?.stripeCustomerId) {
        return []
      }

      const stripe = stripeClient.getClient()
      const paymentMethods = await stripe.paymentMethods.list({
        customer: subscription.stripeCustomerId,
        type: 'card',
      })

      // Get customer to check default payment method
      const customer = await stripe.customers.retrieve(subscription.stripeCustomerId)
      const defaultPaymentMethodId =
        typeof customer !== 'string' && !customer.deleted
          ? customer.invoice_settings.default_payment_method
          : null

      return paymentMethods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand || 'unknown',
        last4: pm.card?.last4 || '****',
        expMonth: pm.card?.exp_month || 0,
        expYear: pm.card?.exp_year || 0,
        isDefault: pm.id === defaultPaymentMethodId,
      }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error fetching payment methods', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error fetching payment methods: ${message}`,
      })
    }
  }),

  // Create setup intent for adding payment method (cached stripeCustomerId)
  createSetupIntent: cloudOnlyProcedure.mutation(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const subscription = await getCachedSubscription(organizationId)

      if (!subscription?.stripeCustomerId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No Stripe customer found' })
      }

      const stripe = stripeClient.getClient()
      const setupIntent = await stripe.setupIntents.create({
        customer: subscription.stripeCustomerId,
        payment_method_types: ['card'],
      })

      return { clientSecret: setupIntent.client_secret }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error creating setup intent', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error creating setup intent: ${message}`,
      })
    }
  }),

  // Set default payment method (cached stripeCustomerId)
  setDefaultPaymentMethod: cloudOnlyProcedure
    .input(z.object({ paymentMethodId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscription = await getCachedSubscription(organizationId)

        if (!subscription?.stripeCustomerId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No Stripe customer found' })
        }

        const stripe = stripeClient.getClient()
        await stripe.customers.update(subscription.stripeCustomerId, {
          invoice_settings: {
            default_payment_method: input.paymentMethodId,
          },
        })

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error setting default payment method', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error setting default payment method: ${message}`,
        })
      }
    }),

  // Delete payment method
  deletePaymentMethod: cloudOnlyProcedure
    .input(z.object({ paymentMethodId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const stripe = stripeClient.getClient()
        await stripe.paymentMethods.detach(input.paymentMethodId)

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error deleting payment method', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error deleting payment method: ${message}`,
        })
      }
    }),

  // Update subscription directly (without Stripe Checkout)
  updateSubscriptionDirect: cloudOnlyProcedure
    .input(
      z.object({
        planName: z.string(),
        billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
        seats: z.number().min(1),
        paymentMethodId: z.string().optional(),
        previousPaymentMethodId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const organizationId = getUserOrganizationId(ctx.session)
        if (!organizationId) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
        }

        const subscriptionService = new SubscriptionService(ctx.db, WEBAPP_URL)

        const result = await subscriptionService.updateSubscriptionDirect({
          organizationId,
          userId: ctx.session.user.id,
          ...input,
        })

        await onCacheEvent('plan.changed', { orgId: organizationId })

        return result
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''

        logger.error('Error updating subscription directly', { error: message })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error updating subscription: ${message}`,
        })
      }
    }),

  // Cancel scheduled plan change (cached read, DB write)
  cancelScheduledChange: cloudOnlyProcedure.mutation(async ({ ctx }) => {
    try {
      const organizationId = getUserOrganizationId(ctx.session)
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID not found' })
      }

      const cachedSub = await getCachedSubscription(organizationId)

      if (!cachedSub?.scheduledPlanId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No scheduled change found',
        })
      }

      // Clear scheduled change in DB
      await ctx.db
        .update(schema.PlanSubscription)
        .set({
          scheduledPlanId: null,
          scheduledPlan: null,
          scheduledBillingCycle: null,
          scheduledSeats: null,
          scheduledChangeAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.PlanSubscription.id, cachedSub.id))

      // Revert Stripe subscription to current plan
      if (cachedSub.planId && cachedSub.stripeSubscriptionId) {
        const planMap = await getAppCache().get('planMap')
        const plan = planMap[cachedSub.planId]

        if (plan) {
          const priceId =
            cachedSub.billingCycle === 'ANNUAL'
              ? plan.stripePriceIdAnnual
              : plan.stripePriceIdMonthly

          if (priceId) {
            const stripe = stripeClient.getClient()
            const stripeSubscription = await stripe.subscriptions.retrieve(
              cachedSub.stripeSubscriptionId
            )

            await stripe.subscriptions.update(cachedSub.stripeSubscriptionId, {
              items: [
                {
                  id: stripeSubscription.items.data[0]!.id,
                  price: priceId,
                  quantity: cachedSub.seats,
                },
              ],
              proration_behavior: 'none',
            })
          }
        }
      }

      await onCacheEvent('plan.changed', { orgId: organizationId })

      return { success: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''

      logger.error('Error canceling scheduled change', { error: message })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error canceling scheduled change: ${message}`,
      })
    }
  }),

  /**
   * Get reactivation details for an organization
   * Used by the reactivation page to show org status and deletion timeline
   */
  getReactivationDetails: cloudOnlyProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId } = input

        // Verify user has access to this organization
        const membership = await ctx.db.query.OrganizationMember.findFirst({
          where: (members, { and, eq }) =>
            and(
              eq(members.organizationId, organizationId),
              eq(members.userId, ctx.session.user.id)
            ),
        })

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this organization',
          })
        }

        // Get organization details
        const organization = await ctx.db.query.Organization.findFirst({
          where: (orgs, { eq }) => eq(orgs.id, organizationId),
        })

        if (!organization) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Organization not found',
          })
        }

        // Get subscription details
        const subscription = await ctx.db.query.PlanSubscription.findFirst({
          where: (subs, { eq }) => eq(subs.organizationId, organizationId),
          with: { plan: true },
        })

        if (!subscription) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Subscription not found',
          })
        }

        // Check if eligible for reactivation
        const isEligibleForReactivation =
          subscription.hasTrialEnded &&
          (subscription.trialConversionStatus === 'EXPIRED_WITHOUT_CONVERSION' ||
            subscription.trialConversionStatus === 'CANCELED_DURING_TRIAL') &&
          !subscription.stripeSubscriptionId

        // Calculate deletion timeline
        const deletionDate =
          subscription.deletionScheduledDate ||
          (subscription.trialEnd
            ? new Date(subscription.trialEnd.getTime() + 14 * 24 * 60 * 60 * 1000)
            : null)

        const hoursUntilDeletion = deletionDate
          ? Math.floor((deletionDate.getTime() - Date.now()) / (1000 * 60 * 60))
          : null

        // Get organization stats
        const stats = await getOrganizationStats(ctx.db, organizationId)

        return {
          organizationId: organization.id,
          organizationName: organization.name,
          ownerEmail: organization.ownerEmail,
          isEligibleForReactivation,
          deletionScheduledDate: deletionDate,
          hoursUntilDeletion,
          daysUntilDeletion: hoursUntilDeletion ? Math.floor(hoursUntilDeletion / 24) : null,
          lastNotificationSent: subscription.lastDeletionNotificationSent,
          currentSeats: subscription.seats,
          lastBillingCycle: subscription.billingCycle,
          stats,
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error

        logger.error('Error fetching reactivation details', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch reactivation details',
        })
      }
    }),
})

/**
 * Get organization statistics for reactivation page
 */
async function getOrganizationStats(db: any, organizationId: string) {
  try {
    // Get ticket count via EntityInstance (Ticket table deleted)
    const ticketCount = await db.query.EntityInstance.findMany({
      where: (instances: any, { eq, and }: any) =>
        and(
          eq(instances.organizationId, organizationId),
          eq(instances.entityDefinitionId, 'ticket')
        ),
    }).then((instances: any[]) => instances.length)

    // Get member count
    const memberCount = await db.query.OrganizationMember.findMany({
      where: (members: any, { eq }: any) => eq(members.organizationId, organizationId),
    }).then((members: any[]) => members.length)

    // Get integration count
    const integrationCount = await db.query.EmailIntegration.findMany({
      where: (integrations: any, { eq }: any) => eq(integrations.organizationId, organizationId),
    }).then((integrations: any[]) => integrations.length)

    return {
      totalTickets: ticketCount,
      totalMembers: memberCount,
      totalIntegrations: integrationCount,
    }
  } catch (error) {
    logger.warn('Failed to fetch organization stats', { organizationId, error })
    return null
  }
}

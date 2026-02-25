import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { disableWebhooks, isShopifyConnected, SyncManager } from '@auxx/lib/shopify'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('shopify-router')

const jobTypes: { [key: string]: string } = {
  customers: 'syncCustomersJob',
  orders: 'syncOrdersJob',
  products: 'syncProductsJob',
  all: 'syncCustomersJob',
  // shopify_sync_all: 'syncAllJob'
}

export const shopifyRouter = createTRPCRouter({
  getAuthUrl: adminProcedure
    .input(z.object({ shopDomain: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        // Check if user has access to an organization
        // Normalize shop domain (remove protocol if present)

        const normalizedDomain = input.shopDomain.replace(/^https?:\/\//, '')

        // Create auth URL
        const url = new URL(`${WEBAPP_URL}/api/shopify/oauth2`)
        url.searchParams.append('shop_domain', normalizedDomain)

        return { url: url.toString() }
      } catch (error) {
        logger.error('Error generating Shopify auth URL:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to generate Shopify auth URL',
        })
      }
    }),

  // Check if the organization has any Shopify integrations
  hasIntegration: protectedProcedure
    // .input(z.object({ organizationId: z.string().optional() }))
    .query(async ({ ctx }) => {
      try {
        // Use provided organizationId or default to user's current organization
        const { organizationId } = ctx.session

        // Count Shopify integrations for the organization
        const [row] = await db
          .select({ cnt: count() })
          .from(schema.ShopifyIntegration)
          .where(
            and(
              eq(schema.ShopifyIntegration.organizationId, organizationId),
              eq(schema.ShopifyIntegration.enabled, true)
            )
          )
        const integrationCount = Number(row?.cnt || 0)

        return { hasIntegration: integrationCount > 0, count: integrationCount }
      } catch (error) {
        logger.error('Error checking for Shopify integrations:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error ? error.message : 'Failed to check for Shopify integrations',
        })
      }
    }),
  // Get integrations for the current organization
  getIntegrations: protectedProcedure.query(async ({ ctx }) => {
    // Get user's organization
    // Get all organizations the user is a member of
    // const organizationIds = user.memberships.map((m) => m.organizationId)
    const { organizationId } = ctx.session
    // Get all Shopify integrations for these organizations
    const integrations = await db
      .select()
      .from(schema.ShopifyIntegration)
      .where(eq(schema.ShopifyIntegration.organizationId, organizationId))
      .orderBy(desc(schema.ShopifyIntegration.createdAt))

    return integrations
  }),

  // Toggle an integration's enabled status
  toggleIntegration: adminProcedure
    .input(z.object({ integrationId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { organizationId } = ctx.session
      const { integrationId, enabled } = input

      // Find the integration
      const [integration] = await db
        .select()
        .from(schema.ShopifyIntegration)
        .where(
          and(
            eq(schema.ShopifyIntegration.id, input.integrationId),
            eq(schema.ShopifyIntegration.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
      }

      // Update the integration
      const [updatedIntegration] = await db
        .update(schema.ShopifyIntegration)
        .set({ enabled })
        .where(eq(schema.ShopifyIntegration.id, integrationId))
        .returning()

      return updatedIntegration
    }),

  // Sync products from Shopify
  sync: adminProcedure
    .input(
      z.object({
        integrationId: z.string(),
        type: z.enum(['orders', 'products', 'customers', 'all']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Find the integration
        const [integration] = await db
          .select({
            id: schema.ShopifyIntegration.id,
            organizationId: schema.ShopifyIntegration.organizationId,
          })
          .from(schema.ShopifyIntegration)
          .where(eq(schema.ShopifyIntegration.id, input.integrationId))
          .limit(1)

        if (!integration) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
        }

        const integrationId = input.integrationId
        const organizationId = integration.organizationId
        const type = `shopify_sync_${input.type}`
        logger.info(`Syncing Shopify ${input.type}`, { integrationId, organizationId, type })
        const sync = await SyncManager.create({ organizationId, integrationId, type })
        const syncId = sync.id
        const shopifyQueue = getQueue(Queues.shopifyQueue)
        await shopifyQueue.add(jobTypes[input.type], { syncId, organizationId, integrationId })

        // return result
      } catch (error) {
        logger.error(`Error syncing Shopify ${input.type}:`, { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : `Failed to sync ${input.type}`,
        })
      }
    }),

  // Delete an integration
  deleteIntegration: adminProcedure
    .input(z.object({ integrationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { organizationId } = ctx.session
        // Find the integration
        const [integration] = await db
          .select()
          .from(schema.ShopifyIntegration)
          .where(
            and(
              eq(schema.ShopifyIntegration.id, input.integrationId),
              eq(schema.ShopifyIntegration.organizationId, organizationId)
            )
          )
          .limit(1)

        if (!integration) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
        }
        await disableWebhooks(integration.id)
        await db
          .delete(schema.Subscription)
          .where(eq(schema.Subscription.integrationId, input.integrationId))

        // Start a transaction to delete related data before deleting the integration
        await db.transaction(async (tx) => {
          // Delete related orders
          await tx.delete(schema.Order).where(eq(schema.Order.integrationId, input.integrationId))

          // Delete related customers
          await tx
            .delete(schema.shopify_customers)
            .where(eq(schema.shopify_customers.integrationId, input.integrationId))

          // Delete related products
          await tx
            .delete(schema.Product)
            .where(eq(schema.Product.integrationId, input.integrationId))
          // Delete related sync jobs
          await tx
            .delete(schema.SyncJob)
            .where(eq(schema.SyncJob.integrationId, input.integrationId))
          // Delete related webhook events
          await tx
            .delete(schema.WebhookEvent)
            .where(eq(schema.WebhookEvent.integrationId, input.integrationId))

          // Delete the integration
          await tx
            .delete(schema.ShopifyIntegration)
            .where(eq(schema.ShopifyIntegration.id, input.integrationId))
        })

        return { success: true }
      } catch (error) {
        console.error('Error deleting Shopify integration:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete integration',
        })
      }
    }),

  // Check if Shopify is connected for an organization
  isConnected: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        // Check if user has permission to access this organization
        const [membership] = await db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.userId, ctx.session.user.id),
              eq(schema.OrganizationMember.organizationId, input.organizationId)
            )
          )
          .limit(1)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You don't have access to this organization",
          })
        }

        // Check if Shopify is connected
        const connected = await isShopifyConnected(input.organizationId)

        return { connected }
      } catch (error) {
        console.error('Error checking Shopify connection:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check Shopify connection',
        })
      }
    }),

  // Get sync jobs for an integration
  getSyncJobs: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        limit: z.number().optional(),
        status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // const { organizationId } = ctx.session
        const { integrationId } = input

        // Find the integration
        const [integration] = await db
          .select()
          .from(schema.ShopifyIntegration)
          .where(eq(schema.ShopifyIntegration.id, integrationId))
          .limit(1)

        if (!integration) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
        }

        // Check if user has permission
        const [membership] = await db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.userId, ctx.session.user.id),
              eq(schema.OrganizationMember.organizationId, integration.organizationId)
            )
          )
          .limit(1)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You don't have access to this integration",
          })
        }

        // Fetch sync jobs
        const syncJobs = await db
          .select()
          .from(schema.SyncJob)
          .where(
            and(
              eq(schema.SyncJob.integrationId, integrationId),
              ...(input.status ? [eq(schema.SyncJob.status, input.status as any)] : [])
            )
          )
          .orderBy(desc(schema.SyncJob.createdAt))
          .limit(input.limit || 10)

        return syncJobs
      } catch (error) {
        console.error('Error fetching Shopify sync jobs:', error)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch sync jobs' })
      }
    }),

  // Get webhook events for an integration
  getWebhookEvents: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
        limit: z.number().optional(),
        topic: z.string().optional(),
        processed: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // const { organizationId } = ctx.session
        const { integrationId, limit, topic, processed } = input
        // Find the integration
        const [integration] = await db
          .select()
          .from(schema.ShopifyIntegration)
          .where(eq(schema.ShopifyIntegration.id, input.integrationId))
          .limit(1)

        if (!integration) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
        }

        // Check if user has permission
        const [membership] = await db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.userId, ctx.session.user.id),
              eq(schema.OrganizationMember.organizationId, integration.organizationId)
            )
          )
          .limit(1)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You don't have access to this integration",
          })
        }

        // Fetch webhook events
        const webhookEvents = await db
          .select()
          .from(schema.WebhookEvent)
          .where(
            and(
              eq(schema.WebhookEvent.integrationId, integrationId),
              ...(topic ? [eq(schema.WebhookEvent.topic, topic)] : [])
            )
          )
          .orderBy(desc(schema.WebhookEvent.createdAt))
          .limit(limit || 50)

        return webhookEvents
      } catch (error) {
        console.error('Error fetching Shopify webhook events:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch webhook events',
        })
      }
    }),

  // Get integration details
  getIntegrationDetails: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        // const { organizationId } = ctx.session
        const { integrationId } = input

        // Find the integration
        const [integration] = await db
          .select()
          .from(schema.ShopifyIntegration)
          .where(eq(schema.ShopifyIntegration.id, integrationId))
          .limit(1)

        if (!integration) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' })
        }

        // Check if user has permission
        const [membership] = await db
          .select({ id: schema.OrganizationMember.id })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.userId, ctx.session.user.id),
              eq(schema.OrganizationMember.organizationId, integration.organizationId)
            )
          )
          .limit(1)

        if (!membership) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You don't have access to this integration",
          })
        }

        // Get integration stats
        const [sj] = await db
          .select({ cnt: count() })
          .from(schema.SyncJob)
          .where(eq(schema.SyncJob.integrationId, integrationId))
        const [pc] = await db
          .select({ cnt: count() })
          .from(schema.Product)
          .where(eq(schema.Product.integrationId, integrationId))
        const [wc] = await db
          .select({ cnt: count() })
          .from(schema.WebhookEvent)
          .where(eq(schema.WebhookEvent.integrationId, integrationId))
        const syncJobsCount = Number(sj?.cnt || 0)
        const productCount = Number(pc?.cnt || 0)
        const webhookEventsCount = Number(wc?.cnt || 0)

        return { integration, stats: { syncJobsCount, productCount, webhookEventsCount } }
      } catch (error) {
        console.error('Error fetching Shopify integration details:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch integration details',
        })
      }
    }),
})

import { getProvider, type ShopifyBillingProvider, stripeClient } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { findCredential } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { saveAppConnection } from '@auxx/lib/apps'
import { getOrgCache, isOrgMember, onCacheEvent, resolveAppSlug } from '@auxx/lib/cache'
import { ConflictError } from '@auxx/lib/errors'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { OrganizationService } from '@auxx/lib/organizations'
import { disableWebhooks, isShopifyConnected, SyncManager } from '@auxx/lib/shopify'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { installApp } from '@auxx/services/apps'
import { TRPCError } from '@trpc/server'
import { and, count, desc, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { setUserDefaultOrganization } from '~/server/auth/set-default-organization'
import { adminProcedure, createTRPCRouter, notDemo, protectedProcedure } from '../trpc'

const CLAIM_COOKIE_NAME = 'shopify_claim_token'

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
    .use(notDemo('connect Shopify'))
    .mutation(async ({ ctx, input }) => {
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
    .use(notDemo('toggle Shopify integrations'))
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
    .use(notDemo('sync Shopify data'))
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
    .use(notDemo('disconnect Shopify'))
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

  /**
   * Finalize an App-Store-initiated Shopify install by attaching the parked credential
   * to the chosen organization and parking a Shopify-billed PlanSubscription row, then
   * handing back the URL of Shopify's hosted plan-selection page. Under Shopify App
   * Pricing the merchant picks the plan on Shopify's page (not in-app) and approves the
   * charge there; we observe the resulting contract via the Admin API on the
   * post-approval landing route + the worker poll.
   *
   * Reads the claim token from the `shopify_claim_token` cookie (or the cross-device
   * `claimToken` input), validates the user is a member of `organizationId`, lazily
   * creates the AppInstallation, writes the Credential + ShopifyIntegration
   * rows, then reconciles any pre-existing PlanSubscription row:
   * - **No row** (the shopify-claim signupSource skips the Stripe trial seed — the hot path
   *   for a fresh App Store merchant): upsert the Shopify row + return the hosted plan-picker
   *   URL.
   * - **Live Stripe row** (existing Auxx customer installing via the App Store): keep Stripe
   *   billing untouched, skip the plan picker, return `{ redirectUrl: '/app' }`. Per the §4.5
   *   operating model, connecting Shopify never changes an existing billing relationship.
   * - **Dead Stripe row** (incomplete/canceled): drop it and fall through to the Shopify upsert.
   * The upserted Shopify row is `status: 'incomplete'`, `planId` null until the merchant picks,
   * `shopifyShopDomain` set for the Admin API read.
   */
  finalizeAppStoreInstall: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        claimToken: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cookieStore = await cookies()
      // Cookie is the primary source (prod, single-device). The optional input is the
      // cross-device / cross-domain fallback used when the cookie isn't present —
      // mirrors the read priority on the claim page itself.
      const claimToken = cookieStore.get(CLAIM_COOKIE_NAME)?.value ?? input.claimToken
      if (!claimToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No pending Shopify install. Reinstall from the App Store to continue.',
        })
      }

      const userId = ctx.session.user.id
      const { organizationId } = input

      // Membership check via cached members set (any role can connect — we land here
      // from an App Store install, not a permission-gated UI).
      if (!(await isOrgMember(organizationId, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not a member of this organization.',
        })
      }

      const redis = await getRedisClient()
      if (!redis) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Redis unavailable' })
      }

      const claimKey = `shopify:pending-claim:${claimToken}`
      const raw = await redis.get(claimKey)
      if (!raw) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This install link has expired. Reinstall from the App Store to continue.',
        })
      }
      const claim = JSON.parse(raw) as {
        shop: string
        accessToken: string
        refreshToken?: string
        expiresAt?: string
        scope?: string
        connectionDefinitionId: string
      }

      const appId = await resolveAppSlug('shopify')
      if (!appId) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Shopify app not found' })
      }

      // Lazy: ensure AppInstallation exists for this org. If already installed,
      // resolve the installationId via the cached installedApps set.
      let installationId: string | null = null
      const installResult = await installApp({
        appId,
        organizationId,
        installationType: 'production',
        installedById: userId,
      })
      if (installResult.isOk()) {
        installationId = installResult.value.installation.id
        await onCacheEvent('app.installed', { orgId: organizationId })
      } else if (installResult.error.code === 'APP_ALREADY_INSTALLED') {
        const installedApps = await getOrgCache().get(organizationId, 'installedApps')
        installationId =
          installedApps.find((i) => i.app.id === appId && i.installationType === 'production')
            ?.installationId ?? null
      } else {
        logger.error('Failed to install Shopify app for org', {
          error: installResult.error,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: installResult.error.message,
        })
      }

      if (!installationId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to resolve Shopify installation',
        })
      }

      // Guarantee the org has a handle before saveAppConnection fires the
      // `connection-added` event — its Lambda context validator rejects a null
      // organizationHandle. A fresh shopify-claim org hasn't been through the
      // onboarding handle-picker yet, so derive a provisional handle from the
      // shop domain (editable later; the picker pre-fills from the stored value).
      await new OrganizationService(db).ensureOrganizationHandle({
        organizationId,
        userId,
        userEmail: ctx.session.user.email ?? undefined,
        seed: claim.shop,
      })

      // Reuse the single org-scoped Shopify connection if one already exists. Without
      // this, every App Store (re)install inserts a fresh Credential row — and
      // since Shopify revokes the old token whenever it issues a new one, getAppConnection
      // can hand a stale (revoked) row to the Admin API read, 401-ing the billing sync so
      // the PlanSubscription never leaves `incomplete`. One shop = one org-scoped token,
      // updated in place.
      const existingConnResult = await findCredential({
        organizationId,
        kind: 'app',
        appId,
        userId: null,
      })
      const existingConn = existingConnResult.isOk() ? existingConnResult.value : null

      const saveResult = await saveAppConnection(
        appId,
        installationId,
        'Shopify',
        organizationId,
        userId,
        null, // org-scoped
        {
          accessToken: claim.accessToken,
          refreshToken: claim.refreshToken,
          expiresAt: claim.expiresAt,
          metadata: {
            scope: claim.scope,
            shopDomain: claim.shop,
            // The hourly token refresh interpolates {shop} in the ConnectionDefinition's
            // access-token URL from `connectionVariables` (oauth2-workflow.ts).
            // Without this the App-Store-saved credential refreshes against a literal
            // `https://{shop}.myshopify.com/...` URL and the connection dies an hour after
            // install — store the subdomain exactly as the in-app OAuth callback does.
            connectionVariables: { shop: claim.shop.replace(/\.myshopify\.com$/, '') },
          },
        },
        existingConn ? { connectionId: existingConn.id } : undefined
      )

      if (saveResult.isErr()) {
        logger.error('Failed to save Shopify connection', {
          error: saveResult.error,
          organizationId,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save Shopify connection',
        })
      }

      // Mirror what the in-app OAuth callback does: persist a `ShopifyIntegration`
      // row for the data-integration consumers (product/customer sync). The
      // AppConnection write above is the workflow credentials store the billing
      // provider's Admin API read loads the access token from.
      await db
        .insert(schema.ShopifyIntegration)
        .values({
          organizationId,
          shopDomain: claim.shop,
          accessToken: claim.accessToken,
          scope: claim.scope,
          createdById: userId,
          enabled: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.ShopifyIntegration.organizationId, schema.ShopifyIntegration.shopDomain],
          set: {
            accessToken: claim.accessToken,
            scope: claim.scope,
            updatedAt: new Date(),
            enabled: true,
          },
        })

      await redis.del(claimKey)
      cookieStore.delete(CLAIM_COOKIE_NAME)

      // Reconcile any pre-existing PlanSubscription row. Hot path: new claim signup
      // hits no row (shopify-claim signupSource skipped the trial seeder). Fallback
      // path: existing Auxx user signed in on the claim page — their org may have a
      // Stripe trial or live Stripe subscription that has to be reconciled before we
      // upsert the Shopify billing row (PlanSubscription has uniqueIndex on
      // organizationId).
      const existing = await db.query.PlanSubscription.findFirst({
        where: (s, { eq: e }) => e(s.organizationId, organizationId),
      })

      if (existing?.billingProvider === 'stripe') {
        // Operating model (plans/billing/00-multi-provider-billing-overview.md §4.5): an
        // existing Stripe-billed org that connects Shopify keeps its Stripe billing. We
        // honor that on the App Store install path too — rather than forcing a provider
        // switch (or dead-ending on an active sub), attach the Shopify data integration
        // (credentials + ShopifyIntegration already saved above) and leave billing
        // untouched: no Shopify PlanSubscription row, no hosted plan picker.
        const stripeIsLive =
          existing.status !== 'incomplete' &&
          existing.status !== 'canceled' &&
          existing.status !== 'incomplete_expired'
        if (stripeIsLive) {
          // Activate the picked workspace first so the apps page opens it rather than the
          // user's current default org, then drop them on the Shopify app's connections
          // page — the data integration is now connected and billing is unchanged.
          if (ctx.session.user.defaultOrganizationId !== organizationId) {
            await setUserDefaultOrganization(db, userId, organizationId)
          }
          return {
            redirectUrl: '/app/settings/apps/installed/shopify/connections',
            shop: claim.shop,
          }
        }
        // Dead Stripe row (incomplete / canceled / incomplete_expired) — no working
        // billing. Cancel any lingering Stripe sub and drop the row so the Shopify upsert
        // below can establish billing through the App Store path. Calling Stripe directly —
        // not via resolveBillingProvider — because we're explicitly reconciling that row;
        // the resolver picks the provider based on the current row, which is exactly the
        // value we're about to change. Done this way once at this site only.
        if (existing.stripeSubscriptionId) {
          try {
            await stripeClient.getClient().subscriptions.cancel(existing.stripeSubscriptionId)
          } catch (error) {
            logger.warn('Failed to cancel pre-existing Stripe subscription during claim', {
              organizationId,
              stripeSubscriptionId: existing.stripeSubscriptionId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        await db.delete(schema.PlanSubscription).where(eq(schema.PlanSubscription.id, existing.id))
      } else if (existing?.billingProvider === 'shopify' && existing.status !== 'canceled') {
        // The selected workspace is already billed through Shopify. Don't try to
        // re-link it — decide where to send the merchant based on the existing row.
        if (existing.shopifyShopDomain !== claim.shop) {
          // One org bills exactly one shop. Re-claiming a *different* shop into an
          // already-billed workspace is a genuine conflict — name the shop that holds it.
          throw new ConflictError(
            `This workspace already bills through Shopify for ${existing.shopifyShopDomain}. Choose a different workspace for this shop.`
          )
        }

        // Same shop, already linked. An `incomplete` row means the merchant never
        // approved a plan on Shopify's hosted page — resume plan selection. Any live
        // status (active/trialing/past_due/paused) just opens their workspace.
        if (existing.status === 'incomplete') {
          const provider = getProvider('shopify') as ShopifyBillingProvider
          const redirectUrl = await provider.getPlanSelectionUrl(organizationId)
          return { redirectUrl, shop: claim.shop }
        }
        // Activate the picked workspace before sending them in, so `/app` opens it
        // rather than the user's current default org.
        if (ctx.session.user.defaultOrganizationId !== organizationId) {
          await setUserDefaultOrganization(db, userId, organizationId)
        }
        return { redirectUrl: '/app', shop: claim.shop }
      }
      // 'shopify' + 'canceled' (reinstall) falls through to the upsert below — the
      // merchant re-enters Shopify's picker and we observe the fresh contract on return.

      // Upsert the Shopify PlanSubscription row. `planId` stays null until the merchant
      // picks a plan on Shopify's hosted page; `status` is `incomplete` until the
      // post-approval landing route reads the contract from the Admin API. Writing
      // billingProvider='shopify' here is what makes `resolveBillingProvider` route
      // future calls through the Shopify provider. `shopifyShopDomain` drives the Admin
      // API read — no Shop GID needed (the read is shop-token-scoped).
      await db
        .insert(schema.PlanSubscription)
        .values({
          organizationId,
          planId: null,
          plan: 'pending', // satisfy the legacy NOT NULL text column
          billingProvider: 'shopify',
          shopifyShopDomain: claim.shop,
          status: 'incomplete',
          seats: 1,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.PlanSubscription.organizationId,
          set: {
            billingProvider: 'shopify',
            shopifyShopDomain: claim.shop,
            status: 'incomplete',
            canceledAt: null,
            updatedAt: new Date(),
          },
        })

      // Hand back the Shopify hosted pricing-page URL. The merchant picks the plan +
      // interval there, approves, and is redirected to /billing/subscription/activated.
      const provider = getProvider('shopify') as ShopifyBillingProvider
      const redirectUrl = await provider.getPlanSelectionUrl(organizationId)
      return { redirectUrl, shop: claim.shop }
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

import { getProvider, type ShopifyBillingProvider, stripeClient } from '@auxx/billing'
import { listCredentials, setDefaultCredential } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { installApp, saveAppConnection } from '@auxx/lib/apps'
import { getOrgCache, isOrgMember, onCacheEvent, resolveAppSlug } from '@auxx/lib/cache'
import { ConflictError } from '@auxx/lib/errors'
import { OrganizationService } from '@auxx/lib/organizations'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { TRPCError } from '@trpc/server'
import { and, eq, ne, sql } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { setUserDefaultOrganization } from '~/server/auth/set-default-organization'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const CLAIM_COOKIE_NAME = 'shopify_claim_token'

const logger = createScopedLogger('shopify-router')

export const shopifyRouter = createTRPCRouter({
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
   * creates the AppInstallation, writes the Credential row, then reconciles any
   * pre-existing PlanSubscription row:
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

      // --- Validate before mutating (1c + 1d) --------------------------------
      // Every rejecting branch below runs here — before installApp, saveAppConnection,
      // and the claim burn — so a conflict exits with NOTHING mutated and the claim intact.

      // 1c — cross-org guard (Decision 4 gate). A Shopify grant is per (app, shop) and we
      // store an independent token copy per org credential row; two orgs holding copies for
      // the same shop mutually revoke each other on every token issue/refresh (Part 3). Until
      // the shared-token work lands, a shop may live in exactly one workspace. Reject a claim
      // for a shop already connected to a DIFFERENT org, naming the holder.
      const crossOrgConflict = await db.query.Credential.findFirst({
        where: and(
          eq(schema.Credential.kind, 'app'),
          eq(schema.Credential.appId, appId),
          ne(schema.Credential.organizationId, organizationId),
          sql`${schema.Credential.metadata}->>'shopDomain' = ${claim.shop}`
        ),
        columns: { organizationId: true },
      })
      if (crossOrgConflict) {
        const conflictOrg = await db.query.Organization.findFirst({
          where: eq(schema.Organization.id, crossOrgConflict.organizationId),
          columns: { name: true },
        })
        throw new ConflictError(
          `${claim.shop} is already connected to another workspace${
            conflictOrg?.name ? ` (${conflictOrg.name})` : ''
          }. A store can be connected to only one workspace.`
        )
      }

      // 1d — resolve the billing branch on the existing PlanSubscription up front. The only
      // rejecting billing branch (a live Shopify workspace claiming a DIFFERENT shop) throws
      // here so the mutations never run. The remaining reconcile branches reuse this row below.
      const existing = await db.query.PlanSubscription.findFirst({
        where: eq(schema.PlanSubscription.organizationId, organizationId),
      })
      if (
        existing?.billingProvider === 'shopify' &&
        existing.status !== 'canceled' &&
        existing.shopifyShopDomain !== claim.shop
      ) {
        // One workspace bills exactly one shop. Re-claiming a *different* shop into an
        // already-billed workspace is a genuine conflict — name the shop that holds it.
        throw new ConflictError(
          `This workspace already bills through Shopify for ${existing.shopifyShopDomain}. Choose a different workspace for this shop.`
        )
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
        // Installation-scoped app fields (e.g. customerId) were just
        // provisioned — bust the customFields cache now, not on its TTL.
        await onCacheEvent('custom-field.created', { orgId: organizationId })
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

      // 1a — reconnect the credential FOR THIS SHOP if one exists; otherwise insert a new
      // one. A workspace can hold several Shopify stores (one org-scoped credential each,
      // keyed by `metadata.shopDomain`). Reconnecting the same shop in place is the
      // legitimate reinstall/token-refresh case — Shopify revokes the old token when it
      // issues a new one, so a stale row would 401 the Admin API billing read. A DIFFERENT
      // shop's claim must NOT overwrite an existing store's token (the corruption bug); it
      // inserts a fresh row instead, leaving the other store syncing untouched.
      const orgConnsResult = await listCredentials({
        organizationId,
        kind: 'app',
        appId,
        userId: null,
      })
      const sameShopConn = orgConnsResult.isOk()
        ? orgConnsResult.value.find((c) => c.metadata.shopDomain === claim.shop)
        : undefined

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
            // access-token URL from `connectionVariables` (oauth2-token-grants.ts).
            // Without this the App-Store-saved credential refreshes against a literal
            // `https://{shop}.myshopify.com/...` URL and the connection dies an hour after
            // install — store the subdomain exactly as the in-app OAuth callback does.
            connectionVariables: { shop: claim.shop.replace(/\.myshopify\.com$/, '') },
          },
        },
        sameShopConn ? { connectionId: sameShopConn.id } : undefined
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
      // The credential id for the claimed shop (reconnected or freshly inserted). Used to
      // flip the primary connection to this shop whenever we establish a Shopify anchor.
      const claimedCredentialId = saveResult.value.credentialId

      await redis.del(claimKey)
      cookieStore.delete(CLAIM_COOKIE_NAME)

      // Reconcile the pre-existing PlanSubscription row loaded above (1d). Hot path: a fresh
      // claim signup has no row (shopify-claim signupSource skipped the trial seeder).
      // Fallback path: an existing Auxx user signed in on the claim page — their org may
      // carry a Stripe trial/live subscription reconciled here before the Shopify upsert
      // (PlanSubscription has a uniqueIndex on organizationId).
      if (existing?.billingProvider === 'stripe') {
        // Operating model (plans/billing/00-multi-provider-billing-overview.md §4.5): an
        // existing Stripe-billed org that connects Shopify keeps its Stripe billing. We
        // honor that on the App Store install path too — rather than forcing a provider
        // switch (or dead-ending on an active sub), attach the Shopify data integration
        // (credentials already saved above) and leave billing untouched: no Shopify
        // PlanSubscription row, no hosted plan picker.
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
        // The selected workspace is already billed through Shopify for THIS shop (a
        // different shop already threw ConflictError up front). Don't re-link — decide
        // where to send the merchant based on the existing row. An `incomplete` row means
        // the merchant never approved a plan on Shopify's hosted page — resume plan
        // selection. Any live status (active/trialing/past_due/paused) just opens the workspace.
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
            // The Shop GID is cached per shop (seat-usage reporter). Re-anchoring to a new
            // shop — a canceled-shopify reinstall, a dead-Stripe drop, or an unlinked row —
            // must clear the previous shop's GID so the usage drip re-fetches the right one.
            shopifyShopGid: null,
            status: 'incomplete',
            canceledAt: null,
            updatedAt: new Date(),
          },
        })

      // Flip the primary org-scoped connection to the anchor shop's credential. Billing
      // reads the PRIMARY credential's token but the ROW's shop domain — with two stores,
      // a non-primary anchor credential runs the wrong token against the Admin API → 401 →
      // the subscription never leaves `incomplete`. No-op when there's only one connection.
      const primaryFlip = await setDefaultCredential(claimedCredentialId, organizationId)
      if (primaryFlip.isErr()) {
        logger.warn('Failed to set claimed Shopify credential as primary', {
          organizationId,
          claimedCredentialId,
          error: primaryFlip.error.message,
        })
      }

      // Hand back the Shopify hosted pricing-page URL. The merchant picks the plan +
      // interval there, approves, and is redirected to /billing/subscription/activated.
      const provider = getProvider('shopify') as ShopifyBillingProvider
      const redirectUrl = await provider.getPlanSelectionUrl(organizationId)
      return { redirectUrl, shop: claim.shop }
    }),
})

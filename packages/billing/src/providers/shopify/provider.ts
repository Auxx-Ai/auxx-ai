// packages/billing/src/providers/shopify/provider.ts

import { configService } from '@auxx/credentials'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { computePlanPreviewBase } from '../../services/preview-base'
import { BillingError, ErrorCode } from '../../utils/error-codes'
import type {
  BillingCapabilities,
  BillingPortalInput,
  BillingProvider,
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  PreviewInput,
  PreviewResult,
  ProcessWebhookInput,
  RestoreSubscriptionInput,
} from '../types'
import { type ActiveSubscription, getActiveSubscription } from './active-subscription'
import { mapActiveSubscriptionToStatus } from './status-mapping'
import { dispatchShopifyBillingWebhook } from './webhook'

/**
 * Shopify App Pricing adapter. Plans live in the Partner Dashboard; Shopify hosts the
 * plan picker and owns charge approval / proration / trials / cancellation. We never
 * call a billing GraphQL mutation — `createSubscription` returns a redirect to Shopify's
 * hosted pricing page, and live state is read from the Admin API
 * (`syncFromAdminApi`). See plans/billing/v2/05-provider-rewrite.md.
 */
export class ShopifyBillingProvider implements BillingProvider {
  readonly id = 'shopify' as const
  readonly capabilities: BillingCapabilities = {
    managedPaymentMethods: false, // Shopify Admin owns the card
    selfServeBillingPortal: false, // No portal URL — we deep-link to /admin/charges
    prorationPreview: false, // Shopify prorates but does not preview
    arbitraryBillingCycles: false, // Monthly + annual only
    trialWithoutPaymentMethod: true, // Per-plan trial in Partner Dashboard
    immediateCancellation: false, // Cancellations land at end of cycle
    scheduledDowngrade: true, // Downgrade-to-free is a scheduled cancel
    invoiceLedger: false, // Invoices live in Shopify Admin
  }

  constructor(private readonly db: Database) {}

  /**
   * Builds the redirect to Shopify's hosted pricing page. App Pricing has no documented
   * way to pre-select a plan via URL, so `planName`/`billingCycle` are validated only to
   * guarantee the seed-domain mapping is complete before we send the merchant out — the
   * merchant picks the actual plan + interval on Shopify's page.
   */
  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const shopDomain = await this.loadShopDomain(input.organizationId)

    const targetPlan = await this.db.query.Plan.findFirst({
      where: (plan, { sql }) => sql`LOWER(${plan.name}) = LOWER(${input.planName})`,
    })
    if (!targetPlan) throw new BillingError(ErrorCode.PLAN_NOT_FOUND)
    if (!targetPlan.shopifyPlanHandle) {
      throw new BillingError(
        ErrorCode.PLAN_NOT_AVAILABLE,
        `Plan "${targetPlan.name}" is not configured for Shopify billing (missing plan handle)`
      )
    }

    return { kind: 'redirect', url: this.buildPricingPageUrl(shopDomain) }
  }

  /**
   * Convenience for callers that just need the pricing-page URL without faking a
   * plan-name input (Settings "Manage plan in Shopify Admin", install finalize).
   */
  async getPlanSelectionUrl(organizationId: string): Promise<string> {
    const shopDomain = await this.loadShopDomain(organizationId)
    return this.buildPricingPageUrl(shopDomain)
  }

  async cancelSubscription(_input: CancelSubscriptionInput): Promise<void> {
    throw new BillingError(
      ErrorCode.OPERATION_NOT_SUPPORTED,
      'Shopify subscriptions are canceled by the merchant from Shopify Admin. ' +
        'Direct them to https://{shop}/admin/charges to manage.'
    )
  }

  async restoreSubscription(_input: RestoreSubscriptionInput): Promise<void> {
    throw new BillingError(
      ErrorCode.OPERATION_NOT_SUPPORTED,
      'Shopify subscriptions cannot be restored — the merchant subscribes again via the App Store / pricing page.'
    )
  }

  async createBillingPortalUrl(input: BillingPortalInput): Promise<{ url: string }> {
    const row = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq: e }) => e(sub.organizationId, input.organizationId),
      columns: { shopifyShopDomain: true },
    })
    if (!row?.shopifyShopDomain) {
      throw new BillingError(ErrorCode.NO_CUSTOMER_FOUND, 'No Shopify shop linked to this org')
    }
    return { url: `https://${row.shopifyShopDomain}/admin/charges` }
  }

  async calculatePreview(input: PreviewInput): Promise<PreviewResult> {
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq: e }) => e(sub.organizationId, input.organizationId),
      with: { plan: true },
    })
    const targetPlan = await this.db.query.Plan.findFirst({
      where: (plan, { sql }) => sql`LOWER(${plan.name}) = LOWER(${input.planName})`,
    })
    if (!targetPlan) throw new BillingError(ErrorCode.PLAN_NOT_FOUND)

    const base = computePlanPreviewBase({
      currentSubscription: subscription ?? null,
      targetPlan,
      billingCycle: input.billingCycle,
      seats: input.seats,
    })
    return {
      organizationId: input.organizationId,
      subscriptionId: subscription?.id ?? null,
      transition: base.transition,
      proration: null,
      renewal: base.renewal,
      period_end: subscription?.endDate ?? null,
    }
  }

  async processWebhook(input: ProcessWebhookInput): Promise<{ success: boolean }> {
    if (input.rawBody == null || input.topic == null) {
      throw new Error('Shopify webhook requires rawBody and topic')
    }
    return dispatchShopifyBillingWebhook({
      db: input.db,
      rawBody: input.rawBody,
      topic: input.topic,
      shopDomain: input.shopDomain ?? '',
    })
  }

  /**
   * Shopify-specific extension (not on the BillingProvider interface). Reads the live
   * contract from the Admin API (`currentAppInstallation.activeSubscriptions`, shop-token
   * scoped — no Partner token, no Shop GID) and mirrors it onto the local PlanSubscription
   * row. Called by the redirect-landing route (phase 6) and the worker poll (phase 7).
   * No-op for non-Shopify orgs.
   */
  async syncFromAdminApi(
    organizationId: string,
    opts?: { planHandleHint?: string | null }
  ): Promise<void> {
    const row = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq: e }) => e(sub.organizationId, organizationId),
      columns: { id: true, planId: true, shopifyShopDomain: true, billingProvider: true },
    })
    if (!row?.shopifyShopDomain || row.billingProvider !== 'shopify') {
      return // not a Shopify-billed org
    }

    const sub = await getActiveSubscription({
      shopDomain: row.shopifyShopDomain,
      organizationId,
    })

    // Admin status maps directly — FROZEN (→ past_due) and CANCELLED/empty (→ canceled)
    // need no events query.
    const status = mapActiveSubscriptionToStatus(sub)
    const planId = sub ? await this.resolvePlan(sub, opts?.planHandleHint) : null

    await this.db
      .update(schema.PlanSubscription)
      .set({
        status,
        planId: planId ?? row.planId, // fall back to existing planId if we can't resolve
        billingCycle: sub?.interval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY',
        trialEnd: sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null,
        periodEnd: sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        cancelAtPeriodEnd: status === 'canceled',
        ...(status === 'canceled' ? { canceledAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, row.id))
  }

  /** Reads the denormalized shop domain off the PlanSubscription row (mirrored at install). */
  private async loadShopDomain(organizationId: string): Promise<string> {
    const row = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq: e }) => e(sub.organizationId, organizationId),
      columns: { shopifyShopDomain: true },
    })
    if (!row?.shopifyShopDomain) {
      throw new BillingError(
        ErrorCode.NO_CUSTOMER_FOUND,
        'No Shopify shop linked to this organization'
      )
    }
    return row.shopifyShopDomain
  }

  private buildPricingPageUrl(shopDomain: string): string {
    const storeHandle = extractStoreHandle(shopDomain)
    const appHandle = configService.get<string>('SHOPIFY_APP_HANDLE')
    if (!appHandle) throw new Error('SHOPIFY_APP_HANDLE must be configured')
    return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`
  }

  /**
   * Resolves a local Plan for an Admin API subscription. The Admin API exposes no
   * Partner-Dashboard `plan_handle`, so we resolve in order:
   *   1. `planHandleHint` (the `?plan_handle=` redirect param) → `Plan.shopifyPlanHandle`.
   *      Authoritative when present.
   *   2. Fallback: `sub.name` (the Partner-Dashboard plan name) → `Plan.name`,
   *      case-insensitive — for the worker poll where there's no redirect hint.
   * Returns null when nothing matches (caller keeps the existing planId).
   */
  private async resolvePlan(
    sub: ActiveSubscription,
    planHandleHint?: string | null
  ): Promise<string | null> {
    if (planHandleHint) {
      const byHandle = await this.db.query.Plan.findFirst({
        where: (p, { eq: e }) => e(p.shopifyPlanHandle, planHandleHint),
        columns: { id: true },
      })
      if (byHandle) return byHandle.id
    }

    if (sub.name) {
      const byName = await this.db.query.Plan.findFirst({
        where: (p, { sql }) => sql`LOWER(${p.name}) = LOWER(${sub.name})`,
        columns: { id: true },
      })
      if (byName) return byName.id
    }

    return null
  }
}

/** `'cool-shop.myshopify.com'` → `'cool-shop'`. */
export function extractStoreHandle(shopDomain: string): string {
  const m = shopDomain.match(/^([^.]+)\.myshopify\.com$/)
  if (!m) throw new Error(`Unexpected shop domain: ${shopDomain}`)
  return m[1]
}

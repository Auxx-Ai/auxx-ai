// packages/billing/src/services/subscription-service.ts
/**
 * Core subscription management service.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import type {
  CancelSubscriptionInput,
  RestoreSubscriptionInput,
  SubscriptionWithPlan,
  UpdateSubscriptionDirectInput,
  UpdateSubscriptionDirectResult,
  UpgradeSubscriptionInput,
} from '../types'
import { BillingError, ErrorCode } from '../utils/error-codes'
import { buildUrl } from '../utils/url-helpers'
import { CustomerService } from './customer-service'
import { PlanService } from './plan-service'
import { stripeClient } from './stripe-client'

/** Scoped logger for subscription service operations. */
const logger = createScopedLogger('subscription-service')

/**
 * Coordinates subscription lifecycle operations across the application database and Stripe.
 *
 * Provides utilities for upgrading, canceling, restoring, and provisioning trial subscriptions while ensuring
 * consistent persistence of subscription metadata and appropriate error signaling through domain-specific
 * `BillingError` instances.
 */
export class SubscriptionService {
  private customerService: CustomerService
  private planService: PlanService

  /**
   * Initializes the subscription service with data-layer dependencies and base URL configuration.
   *
   * @param db Database client used for retrieving and mutating subscription state.
   * @param baseUrl Application base URL used for constructing redirect targets.
   */
  constructor(
    private db: Database,
    private baseUrl: string
  ) {
    this.customerService = new CustomerService(db)
    this.planService = new PlanService(db)
  }

  /**
   * Builds a Stripe Checkout session to create or upgrade an organization subscription.
   *
   * Resolves the requested plan, ensures a customer exists, manages existing subscription records, and configures
   * trial eligibility before delegating to Stripe Checkout. Throws domain-specific errors for invalid inputs or
   * unsupported states (e.g., already subscribed).
   *
   * @param input Subscription upgrade payload including organization, plan, and seat data.
   * @param userEmail Email address of the initiating user, used to provision the Stripe customer.
   * @returns Redirect URL metadata returned from Stripe Checkout.
   * @throws BillingError When the plan or price is missing or the organization is already actively subscribed.
   */
  async createCheckoutSession(
    input: UpgradeSubscriptionInput,
    userEmail: string
  ): Promise<{ url: string; redirect: boolean }> {
    // 1. Find plan
    const plan = await this.planService.findPlan({ name: input.planName })
    if (!plan) {
      throw new BillingError(ErrorCode.PLAN_NOT_FOUND)
    }

    // 2. Get or create customer
    const customerId = await this.customerService.getOrCreateCustomer({
      organizationId: input.organizationId,
      email: userEmail,
      metadata: input.metadata,
    })

    // 3. Determine price ID
    const priceId =
      input.billingCycle === 'ANNUAL' ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly

    if (!priceId) {
      throw new BillingError(ErrorCode.PRICE_NOT_CONFIGURED)
    }

    // 4. Find or create subscription record
    const allSubscriptions = await this.db.query.PlanSubscription.findMany({
      where: (sub, { eq }) => eq(sub.organizationId, input.organizationId),
    })

    const activeOrTrialingSubscription = allSubscriptions.find(
      (sub) => sub.status === 'active' || sub.status === 'trialing'
    )

    const incompleteSubscription = allSubscriptions.find((sub) => sub.status === 'incomplete')

    // 5. Check if already subscribed to same plan
    if (
      activeOrTrialingSubscription &&
      activeOrTrialingSubscription.status === 'active' &&
      activeOrTrialingSubscription.plan === plan.name &&
      activeOrTrialingSubscription.seats === (input.seats ?? 1)
    ) {
      throw new BillingError(ErrorCode.ALREADY_SUBSCRIBED)
    }

    // 6. Reuse incomplete subscription if exists and no active subscription
    let subscription = activeOrTrialingSubscription || incompleteSubscription

    if (incompleteSubscription && !activeOrTrialingSubscription) {
      subscription = await this.db
        .update(schema.PlanSubscription)
        .set({
          planId: plan.id,
          plan: plan.name,
          stripeCustomerId: customerId,
          billingCycle: input.billingCycle,
          seats: input.seats ?? 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.PlanSubscription.id, incompleteSubscription.id))
        .returning()
        .then((rows) => rows[0]!)
    }

    if (!subscription) {
      // Rehydrate a previously canceled subscription row to avoid violating the unique organization constraint.
      const reusableSubscription = allSubscriptions.find(
        (sub) => !['active', 'trialing', 'incomplete'].includes(sub.status)
      )

      if (reusableSubscription) {
        subscription = await this.db
          .update(schema.PlanSubscription)
          .set({
            planId: plan.id,
            plan: plan.name,
            stripeCustomerId: customerId,
            status: 'incomplete',
            billingCycle: input.billingCycle,
            seats: input.seats ?? 1,
            stripeSubscriptionId: null,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            scheduledPlanId: null,
            scheduledPlan: null,
            scheduledBillingCycle: null,
            scheduledSeats: null,
            scheduledChangeAt: null,
            periodStart: null,
            periodEnd: null,
            endDate: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.PlanSubscription.id, reusableSubscription.id))
          .returning()
          .then((rows) => rows[0]!)
      }
    }

    // 7. Create new subscription if none exists
    if (!subscription) {
      subscription = await this.db
        .insert(schema.PlanSubscription)
        .values({
          organizationId: input.organizationId,
          planId: plan.id,
          plan: plan.name,
          stripeCustomerId: customerId,
          status: 'incomplete',
          billingCycle: input.billingCycle,
          seats: input.seats ?? 1,
        })
        .returning()
        .then((rows) => rows[0]!)
    }

    if (!subscription) {
      logger.error('Failed to create subscription record')
      throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_FOUND)
    }

    // 8. Check for trial eligibility
    const hasEverTrialed = allSubscriptions.some(
      (s) => s.trialStart || s.trialEnd || s.status === 'trialing'
    )
    const trial = !hasEverTrialed && plan.trial ? { trial_period_days: plan.trial.days } : undefined

    // 9. Create checkout session
    const checkoutSession = await stripeClient.getClient().checkout.sessions.create({
      customer: customerId,
      customer_update: {
        name: 'auto',
        address: 'auto',
      },
      success_url: buildUrl(
        this.baseUrl,
        `/subscription/success?callbackURL=${encodeURIComponent(
          input.successUrl
        )}&subscriptionId=${encodeURIComponent(subscription.id)}`
      ),
      cancel_url: buildUrl(this.baseUrl, input.cancelUrl),
      line_items: [
        {
          price: priceId,
          quantity: input.seats ?? 1,
        },
      ],
      subscription_data: {
        ...trial,
        metadata: {
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          ...input.metadata,
        },
      },
      mode: 'subscription',
      client_reference_id: input.organizationId,
      metadata: {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        ...input.metadata,
      },
    })

    return {
      url: checkoutSession.url!,
      redirect: true,
    }
  }

  /**
   * Cancels subscription at period end - no redirect needed.
   * Access is retained until current billing period expires per business rules.
   *
   * @param input Cancelation payload containing organization context.
   * @throws BillingError When the organization lacks an active subscription record.
   */
  async cancelSubscription(input: CancelSubscriptionInput): Promise<void> {
    const subscription = await this.findActiveSubscription(input.organizationId)

    if (!subscription?.stripeSubscriptionId) {
      throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_FOUND)
    }

    if (!['active', 'trialing'].includes(subscription.status)) {
      throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE)
    }

    logger.info('Canceling subscription', {
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    })

    // Cancel directly via Stripe API - no redirect needed
    await stripeClient.getClient().subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })

    // Update database immediately - clear any scheduled changes since canceling takes precedence
    await this.db
      .update(schema.PlanSubscription)
      .set({
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
        updatedAt: new Date(),
        // Clear any scheduled downgrades - cancellation takes precedence
        scheduledPlanId: null,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledSeats: null,
        scheduledChangeAt: null,
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    logger.info('Subscription canceled successfully', {
      organizationId: input.organizationId,
      willEndAt: subscription.periodEnd,
    })
  }

  /**
   * Reverses a scheduled cancellation for the organization's active subscription.
   *
   * Confirms the subscription is active, currently scheduled for cancellation, and then updates both Stripe and the
   * local record to resume regular billing.
   *
   * @param input Restore payload identifying the organization subscription to restore.
   * @throws BillingError When no active subscription exists or cancellation is not pending.
   */
  async restoreSubscription(input: RestoreSubscriptionInput): Promise<void> {
    const subscription = await this.findActiveSubscription(input.organizationId)

    if (!subscription) {
      throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_FOUND)
    }

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_ACTIVE)
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new BillingError(ErrorCode.NOT_SCHEDULED_FOR_CANCELLATION)
    }

    // Update Stripe subscription
    await stripeClient.getClient().subscriptions.update(subscription.stripeSubscriptionId!, {
      cancel_at_period_end: false,
    })

    // Update database
    await this.db
      .update(schema.PlanSubscription)
      .set({
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))
  }

  /**
   * Provisions a trial subscription in Stripe without requiring an immediate payment method.
   *
   * Ensures the organization is eligible, creates (or reuses) the Stripe customer, establishes a trial subscription
   * via Stripe, and persists the trial metadata locally.
   *
   * @param input Trial creation payload containing organization, plan, user, and duration details.
   * @returns Identifiers for the local subscription and the computed trial end date.
   * @throws BillingError When the plan is missing, a price is not configured, or an active subscription already exists.
   */
  async createTrialSubscription(input: {
    organizationId: string
    planName: string
    userEmail: string
    trialDays: number
  }): Promise<{ subscriptionId: string; trialEnd: Date }> {
    logger.info('Creating trial subscription', {
      organizationId: input.organizationId,
      planName: input.planName,
    })

    // 1. Find plan
    const plan = await this.planService.findPlan({ name: input.planName })
    if (!plan) {
      throw new BillingError(ErrorCode.PLAN_NOT_FOUND)
    }

    // 2. Check if already has subscription
    const existing = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, input.organizationId),
    })
    if (existing) {
      logger.warn('Organization already has subscription', {
        organizationId: input.organizationId,
        existingStatus: existing.status,
      })
      throw new BillingError(ErrorCode.ALREADY_SUBSCRIBED)
    }

    // 3. Create Stripe customer
    const customerId = await this.customerService.getOrCreateCustomer({
      organizationId: input.organizationId,
      email: input.userEmail,
    })

    // 4. Get price ID (default to monthly)
    const priceId = plan.stripePriceIdMonthly
    if (!priceId) {
      throw new BillingError(ErrorCode.PRICE_NOT_CONFIGURED)
    }

    // 5. Calculate trial end
    const trialEnd = new Date()
    trialEnd.setDate(trialEnd.getDate() + input.trialDays)

    // 6. Create Stripe subscription in trial mode
    const stripeSubscription = await stripeClient.getClient().subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: input.trialDays,
      payment_behavior: 'default_incomplete', // Don't require payment during trial
      metadata: {
        organizationId: input.organizationId,
      },
    })

    const firstItem = stripeSubscription.items.data[0]!

    logger.info('Created Stripe subscription', {
      organizationId: input.organizationId,
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
    })

    // 7. Create database subscription record
    const subscription = await this.db
      .insert(schema.PlanSubscription)
      .values({
        organizationId: input.organizationId,
        planId: plan.id,
        plan: plan.name,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSubscription.id,
        status: stripeSubscription.status,
        billingCycle: 'MONTHLY',
        seats: 1,
        trialStart: new Date(),
        trialEnd,
        periodStart: new Date(firstItem.current_period_start * 1000),
        periodEnd: new Date(firstItem.current_period_end * 1000),
      })
      .returning()
      .then((rows) => rows[0]!)

    logger.info('Created trial subscription successfully', {
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      trialEnd,
    })

    return {
      subscriptionId: subscription.id,
      trialEnd,
    }
  }

  /**
   * Retrieves active or trialing subscriptions for the specified organization with associated plan metadata.
   *
   * @param organizationId Identifier of the organization whose subscriptions are being queried.
   * @returns Array of active/trialing subscriptions augmented with associated plan details when available.
   */
  async listActiveSubscriptions(organizationId: string): Promise<SubscriptionWithPlan[]> {
    const subscriptions = await this.db.query.PlanSubscription.findMany({
      where: (sub, { eq }) => eq(sub.organizationId, organizationId),
      with: {
        plan: true,
      },
    })

    return subscriptions
      .filter((s) => s.status === 'active' || s.status === 'trialing')
      .map((s) => ({
        ...s,
        planDetails: s.plan
          ? {
              name: s.plan.name,
              limits: s.plan.featureLimits as Record<string, number>,
              priceId:
                (s.billingCycle === 'ANNUAL'
                  ? s.plan.stripePriceIdAnnual
                  : s.plan.stripePriceIdMonthly) ?? undefined,
            }
          : undefined,
      }))
  }

  /**
   * Calculates a preview of subscription costs including pricing, tax, and proration.
   *
   * Queries the current subscription state, retrieves target plan pricing, calculates proration
   * using Stripe's upcoming invoice preview, and returns structured cost breakdown data.
   *
   * @param input Preview calculation payload containing plan, billing cycle, and seat count.
   * @returns Detailed preview object with transition type, proration details, and renewal costs.
   * @throws BillingError When the requested plan cannot be found.
   */
  async calculateSubscriptionPreview(input: {
    organizationId: string
    planName: string
    billingCycle: 'MONTHLY' | 'ANNUAL'
    seats: number
  }): Promise<{
    organizationId: string
    subscriptionId: string | null
    transition:
      | 'renewal'
      | 'upgrade'
      | 'downgrade'
      | 'seat_addition'
      | 'seat_reduction'
      | 'switch_to_annual'
      | 'switch_to_monthly'
      | 'trial_to_paid'
    proration: { amount: number; currency: string; credit: number; note?: string } | null
    renewal: {
      currency: string
      total: number
      total_excluding_tax: number
      subtotal: number
      tax: number
      line_items: Array<{
        description: string
        amount: number
        quantity: number
        billing_product_id: string
        billing_product_price_id: string | null
      }>
      discount: number
      discount_metadata: null
      billing_starts?: Date | null
    }
    period_end: Date | null
  }> {
    // 1. Get current subscription
    const subscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, input.organizationId),
      with: {
        plan: true,
      },
    })

    // 2. Get target plan from database (need full plan with pricing)
    const targetPlan = await this.db.query.Plan.findFirst({
      where: (plan, { sql }) => sql`LOWER(${plan.name}) = LOWER(${input.planName})`,
    })

    if (!targetPlan) {
      throw new BillingError(ErrorCode.PLAN_NOT_FOUND)
    }

    // 3. Calculate pricing
    const price =
      input.billingCycle === 'MONTHLY' ? targetPlan.monthlyPrice : targetPlan.annualPrice
    const subtotal = (price * input.seats) / 100
    const tax = 0 // TODO: Integrate with Stripe Tax API
    const total = subtotal + tax

    // 4. Determine transition type with enhanced detection
    let proration = null
    let transition:
      | 'renewal'
      | 'upgrade'
      | 'downgrade'
      | 'seat_addition'
      | 'seat_reduction'
      | 'switch_to_annual'
      | 'switch_to_monthly'
      | 'trial_to_paid' = 'renewal'

    // Check for trial subscription
    const isTrialing = subscription?.status === 'trialing'

    // Detect specific types of changes
    const isSamePlan = subscription && subscription.planId === targetPlan.id
    const isSameBillingCycle = subscription && subscription.billingCycle === input.billingCycle
    const currentSeats = subscription?.seats || 0
    const isSeatIncrease = input.seats > currentSeats
    const isSeatDecrease = input.seats < currentSeats
    const isBillingCycleChange = !isSameBillingCycle

    if (subscription?.plan) {
      const currentPlanLevel = subscription.plan.hierarchyLevel
      const targetPlanLevel = targetPlan.hierarchyLevel

      // Determine transition type based on changes
      if (targetPlanLevel > currentPlanLevel) {
        transition = 'upgrade'
      } else if (targetPlanLevel < currentPlanLevel) {
        transition = 'downgrade'
      } else if (isSamePlan && isSameBillingCycle && isSeatIncrease) {
        transition = 'seat_addition'
      } else if (isSamePlan && isSameBillingCycle && isSeatDecrease) {
        transition = 'seat_reduction'
      } else if (isBillingCycleChange) {
        transition = input.billingCycle === 'ANNUAL' ? 'switch_to_annual' : 'switch_to_monthly'
      }
    }

    // 4a. Handle trial subscriptions - no proration applies
    if (isTrialing && subscription) {
      return {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        transition: 'trial_to_paid',
        proration: {
          amount: 0,
          currency: 'USD',
          credit: 0,
          note: 'No charge during trial. Billing starts after trial ends.',
        },
        renewal: {
          currency: 'USD',
          total: Math.round(total * 100),
          total_excluding_tax: Math.round(subtotal * 100),
          subtotal: Math.round(subtotal * 100),
          tax: Math.round(tax * 100),
          line_items: [
            {
              description: `${input.seats} seat × ${targetPlan.name} (at $${(price / 100).toFixed(2)} / ${input.billingCycle === 'MONTHLY' ? 'month' : 'year'})`,
              amount: Math.round(subtotal * 100),
              quantity: input.seats,
              billing_product_id: `seat_${targetPlan.name.toLowerCase()}`,
              billing_product_price_id:
                input.billingCycle === 'MONTHLY'
                  ? targetPlan.stripePriceIdMonthly
                  : targetPlan.stripePriceIdAnnual,
            },
          ],
          discount: 0,
          discount_metadata: null,
          billing_starts: subscription.trialEnd || null,
        },
        period_end: subscription.trialEnd || null,
      }
    }

    if (subscription?.plan) {
      // 5. Calculate proration using Stripe
      if (subscription.stripeSubscriptionId && subscription.stripeCustomerId) {
        const targetPriceId =
          input.billingCycle === 'MONTHLY'
            ? targetPlan.stripePriceIdMonthly
            : targetPlan.stripePriceIdAnnual

        if (targetPriceId) {
          try {
            const stripe = stripeClient.getClient()

            // Get the subscription from Stripe to find the subscription item ID
            const stripeSubscription = await stripe.subscriptions.retrieve(
              subscription.stripeSubscriptionId
            )
            const subscriptionItemId = stripeSubscription.items.data[0]?.id
            const currentPriceId = stripeSubscription.items.data[0]?.price.id

            // Phase 3: Validate price ID match
            if (currentPriceId && currentPriceId !== targetPriceId) {
              logger.info('Price ID mismatch - billing cycle change detected', {
                currentPriceId,
                targetPriceId,
                currentBillingCycle: subscription.billingCycle,
                targetBillingCycle: input.billingCycle,
              })

              // Adjust transition type if it was detected as seat change
              if (transition === 'seat_addition' || transition === 'seat_reduction') {
                transition =
                  input.billingCycle === 'ANNUAL' ? 'switch_to_annual' : 'switch_to_monthly'
              }
            }

            if (subscriptionItemId) {
              // Preview upcoming invoice with proration
              const upcomingInvoice = await stripe.invoices.createPreview({
                customer: subscription.stripeCustomerId,
                subscription: subscription.stripeSubscriptionId,
                subscription_details: {
                  items: [
                    {
                      id: subscriptionItemId,
                      price: targetPriceId,
                      quantity: input.seats,
                    },
                  ],
                  proration_behavior: 'always_invoice',
                },
              })

              proration = {
                amount: upcomingInvoice.amount_due / 100,
                currency: upcomingInvoice.currency,
                credit: (upcomingInvoice.starting_balance || 0) / 100,
              }

              logger.info('Proration calculated', {
                amount: proration.amount,
                currentSeats: subscription.seats,
                targetSeats: input.seats,
                transition,
              })
            }
          } catch (err) {
            logger.error('Error calculating proration', {
              error: err,
              subscriptionId: subscription.stripeSubscriptionId,
              organizationId: input.organizationId,
            })

            // Phase 4: Provide manual proration calculation as fallback
            if (isSeatIncrease || isSeatDecrease) {
              const daysRemaining = subscription.periodEnd
                ? Math.ceil((subscription.periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : 30
              const totalDaysInCycle = input.billingCycle === 'MONTHLY' ? 30 : 365
              const seatDelta = Math.abs(input.seats - (subscription.seats || 0))
              const prorationFactor = daysRemaining / totalDaysInCycle
              const proratedAmount = (price / 100) * seatDelta * prorationFactor

              proration = {
                amount: Math.round(proratedAmount * 100) / 100,
                currency: 'USD',
                credit: 0,
                note: 'Estimated proration (Stripe calculation unavailable)',
              }

              logger.info('Using fallback proration calculation', proration)
            }
          }
        }
      }
    }

    return {
      organizationId: input.organizationId,
      subscriptionId: subscription?.id || null,
      transition,
      proration,
      renewal: {
        currency: 'USD',
        total: Math.round(total * 100),
        total_excluding_tax: Math.round(subtotal * 100),
        subtotal: Math.round(subtotal * 100),
        tax: Math.round(tax * 100),
        line_items: [
          {
            description: `${input.seats} seat × ${targetPlan.name} (at $${(price / 100).toFixed(2)} / ${input.billingCycle === 'MONTHLY' ? 'month' : 'year'})`,
            amount: Math.round(subtotal * 100),
            quantity: input.seats,
            billing_product_id: `seat_${targetPlan.name.toLowerCase()}`,
            billing_product_price_id:
              input.billingCycle === 'MONTHLY'
                ? targetPlan.stripePriceIdMonthly
                : targetPlan.stripePriceIdAnnual,
          },
        ],
        discount: 0,
        discount_metadata: null,
      },
      period_end: subscription?.endDate || null,
    }
  }

  /**
   * Directly updates a subscription using the Stripe Subscriptions API.
   *
   * Updates the subscription immediately without redirecting to Stripe Checkout.
   * Used when billing information and payment method are already on file.
   * Handles upgrades (immediate billing) vs downgrades (scheduled at renewal).
   *
   * @param input Direct update payload containing plan, billing cycle, seats, and payment method.
   * @returns Result object with subscription ID and potential action requirements.
   * @throws BillingError When the plan is not found, price is not configured, or subscription update fails.
   */
  async updateSubscriptionDirect(
    input: UpdateSubscriptionDirectInput
  ): Promise<UpdateSubscriptionDirectResult> {
    logger.info('Updating subscription directly', {
      organizationId: input.organizationId,
      planName: input.planName,
    })

    // 1. Get target plan from database
    const targetPlan = await this.db.query.Plan.findFirst({
      where: (plan, { sql }) => sql`LOWER(${plan.name}) = LOWER(${input.planName})`,
    })

    if (!targetPlan) {
      throw new BillingError(ErrorCode.PLAN_NOT_FOUND)
    }

    // 2. Determine price ID
    const priceId =
      input.billingCycle === 'ANNUAL'
        ? targetPlan.stripePriceIdAnnual
        : targetPlan.stripePriceIdMonthly

    if (!priceId) {
      throw new BillingError(ErrorCode.PRICE_NOT_CONFIGURED)
    }

    // 3. Get current subscription with plan details
    const currentSubscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, input.organizationId),
      with: { plan: true },
    })

    const stripe = stripeClient.getClient()

    // Scenario A: No existing subscription (New Subscription)
    const needsFreshStripeSubscription =
      !currentSubscription ||
      !currentSubscription.stripeSubscriptionId ||
      currentSubscription.status === 'canceled'

    if (needsFreshStripeSubscription) {
      logger.info('Creating new subscription directly', {
        organizationId: input.organizationId,
        existingRecordId: currentSubscription?.id,
      })

      // Get or create customer
      const customerId =
        currentSubscription?.stripeCustomerId ||
        (await this.customerService.getOrCreateCustomer({
          organizationId: input.organizationId,
          email: '', // Email will be filled from user context in the calling code
        }))

      // Set customer default payment method BEFORE creating subscription
      await this.setCustomerDefaultPaymentMethod(stripe, customerId, input.paymentMethodId)

      // Create new subscription directly with Stripe
      const stripeSubscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: input.seats }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'off',
        },
        default_payment_method: input.paymentMethodId,
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          organizationId: input.organizationId,
        },
      })

      // Save to database
      const firstItem = stripeSubscription.items.data[0]!

      // Determine if this is a reactivation from expired trial
      const isReactivationFromTrial =
        currentSubscription?.status === 'canceled' && currentSubscription?.hasTrialEnded

      const basePayload = {
        planId: targetPlan.id,
        plan: targetPlan.name,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSubscription.id,
        status: stripeSubscription.status,
        billingCycle: input.billingCycle,
        seats: input.seats,
        periodStart: new Date(firstItem.current_period_start * 1000),
        periodEnd: new Date(firstItem.current_period_end * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        scheduledPlanId: null,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledSeats: null,
        scheduledChangeAt: null,
        updatedAt: new Date(),
        // Handle reactivation from expired trial
        ...(isReactivationFromTrial
          ? {
              trialConversionStatus: 'CONVERTED_TO_PAID' as const,
              isEligibleForTrial: false,
              trialEligibilityReason: 'Reactivated from expired trial',
            }
          : {}),
      }

      const dbSubscription = await (currentSubscription
        ? this.db
            .update(schema.PlanSubscription)
            .set(basePayload)
            .where(eq(schema.PlanSubscription.id, currentSubscription.id))
            .returning()
            .then((rows) => rows[0]!)
        : this.db
            .insert(schema.PlanSubscription)
            .values({
              organizationId: input.organizationId,
              ...basePayload,
            })
            .returning()
            .then((rows) => rows[0]!))

      await this.detachPreviousPaymentMethod(
        stripe,
        input.previousPaymentMethodId,
        input.paymentMethodId
      )

      // Record subscription history (reactivation or new subscription)
      const changeType = currentSubscription ? 'reactivation' : 'new_subscription'
      await this.recordSubscriptionChange({
        subscriptionId: dbSubscription.id,
        organizationId: input.organizationId,
        userId: input.userId,
        changeType,
        fromPlan: currentSubscription?.plan ?? undefined,
        toPlan: targetPlan.name,
        fromBillingCycle: currentSubscription?.billingCycle ?? undefined,
        toBillingCycle: input.billingCycle,
        fromSeats: currentSubscription?.seats ?? undefined,
        toSeats: input.seats,
        immediate: true,
      })

      // Check if payment requires action
      const latestInvoice = stripeSubscription.latest_invoice
      if (latestInvoice && typeof latestInvoice === 'object' && 'payment_intent' in latestInvoice) {
        const paymentIntent = latestInvoice.payment_intent
        if (paymentIntent && typeof paymentIntent === 'object' && 'status' in paymentIntent) {
          if (paymentIntent.status === 'requires_action') {
            return {
              success: false,
              subscriptionId: dbSubscription.id,
              requiresAction: true,
              clientSecret:
                'client_secret' in paymentIntent
                  ? (paymentIntent.client_secret as string)
                  : undefined,
            }
          }
        }
      }

      logger.info('Created subscription successfully', {
        organizationId: input.organizationId,
        subscriptionId: dbSubscription.id,
        status: stripeSubscription.status,
      })

      return {
        success: true,
        subscriptionId: dbSubscription.id,
        immediate: true,
      }
    }

    // Scenario B: Update Existing Subscription
    if (currentSubscription.stripeSubscriptionId && currentSubscription.plan) {
      logger.info('Updating existing subscription', {
        organizationId: input.organizationId,
        stripeSubscriptionId: currentSubscription.stripeSubscriptionId,
      })

      // Determine change type
      const currentPlanLevel = currentSubscription.plan.hierarchyLevel
      const targetPlanLevel = targetPlan.hierarchyLevel
      const isUpgrade = targetPlanLevel > currentPlanLevel
      const isDowngrade = targetPlanLevel < currentPlanLevel
      const isBillingCycleChange = input.billingCycle !== currentSubscription.billingCycle
      const isMonthlyToAnnual = isBillingCycleChange && input.billingCycle === 'ANNUAL'
      const isAnnualToMonthly = isBillingCycleChange && input.billingCycle === 'MONTHLY'
      const isTrialing = currentSubscription.status === 'trialing'

      logger.info('Detected change type', {
        isUpgrade,
        isDowngrade,
        isBillingCycleChange,
        isMonthlyToAnnual,
        isAnnualToMonthly,
        isTrialing,
        currentLevel: currentPlanLevel,
        targetLevel: targetPlanLevel,
      })

      // Get the subscription from Stripe
      const stripeSubscription = await stripe.subscriptions.retrieve(
        currentSubscription.stripeSubscriptionId
      )
      const subscriptionItemId = stripeSubscription.items.data[0]!.id

      // Handle based on change type
      if (isUpgrade || isMonthlyToAnnual || (isBillingCycleChange && isTrialing)) {
        // UPGRADE, MONTHLY→ANNUAL, or TRIAL BILLING CYCLE CHANGE: Bill immediately with proration
        logger.info('Processing as upgrade - billing immediately')

        // If subscription was canceled, restore it first
        if (currentSubscription.cancelAtPeriodEnd) {
          logger.info('Restoring canceled subscription before upgrade')
          await stripe.subscriptions.update(currentSubscription.stripeSubscriptionId, {
            cancel_at_period_end: false,
          })
        }

        // Capture the updated subscription from Stripe
        // If trialing, end the trial immediately to trigger first payment
        const updatedStripeSubscription = await stripe.subscriptions.update(
          currentSubscription.stripeSubscriptionId,
          {
            items: [{ id: subscriptionItemId, price: priceId, quantity: input.seats }],
            default_payment_method: input.paymentMethodId,
            proration_behavior: 'always_invoice',
            ...(isTrialing ? { trial_end: 'now' } : {}),
          }
        )

        await this.setCustomerDefaultPaymentMethod(
          stripe,
          currentSubscription.stripeCustomerId,
          input.paymentMethodId
        )
        await this.detachPreviousPaymentMethod(
          stripe,
          input.previousPaymentMethodId,
          input.paymentMethodId
        )

        // Get period info from Stripe response
        const firstItem = updatedStripeSubscription.items.data[0]!

        // Determine if this is a trial→paid conversion
        const wasTrialing = isTrialing
        const isNowActive = updatedStripeSubscription.status === 'active'
        const isTrialConversion = wasTrialing && isNowActive

        // Update database with actual status from Stripe
        await this.db
          .update(schema.PlanSubscription)
          .set({
            planId: targetPlan.id,
            plan: targetPlan.name,
            billingCycle: input.billingCycle,
            seats: input.seats,
            status: updatedStripeSubscription.status,
            periodStart: new Date(firstItem.current_period_start * 1000),
            periodEnd: new Date(firstItem.current_period_end * 1000),
            updatedAt: new Date(),
            cancelAtPeriodEnd: updatedStripeSubscription.cancel_at_period_end,
            canceledAt: null,
            // Handle trial→paid conversion
            ...(isTrialConversion
              ? {
                  hasTrialEnded: true,
                  trialConversionStatus: 'CONVERTED_TO_PAID' as const,
                  isEligibleForTrial: false,
                  trialEligibilityReason: 'Already converted from trial',
                }
              : {}),
          })
          .where(eq(schema.PlanSubscription.id, currentSubscription.id))

        // Record subscription history
        await this.recordSubscriptionChange({
          subscriptionId: currentSubscription.id,
          organizationId: input.organizationId,
          userId: input.userId,
          changeType: isTrialConversion ? 'trial_conversion' : 'upgrade',
          fromPlan: currentSubscription.plan?.name,
          toPlan: targetPlan.name,
          fromBillingCycle: currentSubscription.billingCycle,
          toBillingCycle: input.billingCycle,
          fromSeats: currentSubscription.seats,
          toSeats: input.seats,
          immediate: true,
        })

        logger.info('Upgrade processed successfully', {
          subscriptionId: currentSubscription.id,
          newStatus: updatedStripeSubscription.status,
          isTrialConversion,
        })

        return {
          success: true,
          subscriptionId: currentSubscription.id,
          immediate: true,
        }
      } else if (isDowngrade) {
        // DOWNGRADE: Schedule for next renewal - NO immediate charge
        logger.info('Processing as downgrade - scheduling for next renewal', {
          scheduledFor: currentSubscription.periodEnd,
        })

        // If subscription was canceled, restore it first since downgrade means continuing service
        if (currentSubscription.cancelAtPeriodEnd) {
          logger.info('Restoring canceled subscription before scheduling downgrade')
          await stripe.subscriptions.update(currentSubscription.stripeSubscriptionId, {
            cancel_at_period_end: false,
          })
        }

        // Update Stripe subscription to take effect at period end
        const updatedStripeSubscription = await stripe.subscriptions.update(
          currentSubscription.stripeSubscriptionId,
          {
            items: [{ id: subscriptionItemId, price: priceId, quantity: input.seats }],
            proration_behavior: 'none',
            ...(isBillingCycleChange ? {} : { billing_cycle_anchor: 'unchanged' }),
          }
        )

        await this.setCustomerDefaultPaymentMethod(
          stripe,
          currentSubscription.stripeCustomerId,
          input.paymentMethodId
        )
        await this.detachPreviousPaymentMethod(
          stripe,
          input.previousPaymentMethodId,
          input.paymentMethodId
        )

        // Store the scheduled change in database and update status from Stripe
        await this.db
          .update(schema.PlanSubscription)
          .set({
            status: updatedStripeSubscription.status,
            scheduledPlanId: targetPlan.id,
            scheduledPlan: targetPlan.name,
            scheduledBillingCycle: input.billingCycle,
            scheduledSeats: input.seats,
            scheduledChangeAt: currentSubscription.periodEnd,
            updatedAt: new Date(),
            cancelAtPeriodEnd: updatedStripeSubscription.cancel_at_period_end,
            canceledAt: null,
          })
          .where(eq(schema.PlanSubscription.id, currentSubscription.id))

        // Record subscription history
        await this.recordSubscriptionChange({
          subscriptionId: currentSubscription.id,
          organizationId: input.organizationId,
          userId: input.userId,
          changeType: 'downgrade',
          fromPlan: currentSubscription.plan?.name,
          toPlan: targetPlan.name,
          fromBillingCycle: currentSubscription.billingCycle,
          toBillingCycle: input.billingCycle,
          fromSeats: currentSubscription.seats,
          toSeats: input.seats,
          immediate: false,
          scheduledFor: currentSubscription.periodEnd ?? undefined,
        })

        logger.info('Downgrade scheduled successfully')

        return {
          success: true,
          subscriptionId: currentSubscription.id,
          immediate: false,
          scheduledFor: currentSubscription.periodEnd ?? undefined,
        }
      } else {
        // Same plan, just seat or billing cycle change (or trial conversion on same plan)
        logger.info('Processing same-plan change', {
          isTrialing,
          seats: input.seats,
          billingCycle: input.billingCycle,
        })

        // If trialing, end the trial immediately to trigger first payment
        const updatedStripeSubscription = await stripe.subscriptions.update(
          currentSubscription.stripeSubscriptionId,
          {
            items: [{ id: subscriptionItemId, price: priceId, quantity: input.seats }],
            default_payment_method: input.paymentMethodId,
            proration_behavior: 'always_invoice',
            ...(isTrialing ? { trial_end: 'now' } : {}),
          }
        )

        await this.setCustomerDefaultPaymentMethod(
          stripe,
          currentSubscription.stripeCustomerId,
          input.paymentMethodId
        )
        await this.detachPreviousPaymentMethod(
          stripe,
          input.previousPaymentMethodId,
          input.paymentMethodId
        )

        // Get period info from Stripe response
        const firstItem = updatedStripeSubscription.items.data[0]!

        // Determine if this is a trial→paid conversion
        const wasTrialing = isTrialing
        const isNowActive = updatedStripeSubscription.status === 'active'
        const isTrialConversion = wasTrialing && isNowActive

        logger.info('Stripe subscription updated (same-plan path)', {
          stripeStatus: updatedStripeSubscription.status,
          wasTrialing,
          isNowActive,
          isTrialConversion,
        })

        // Determine change type for history
        const isSeatChange = input.seats !== currentSubscription.seats
        const changeType = isTrialConversion
          ? 'trial_conversion'
          : isSeatChange
            ? input.seats > currentSubscription.seats
              ? 'seat_addition'
              : 'seat_reduction'
            : 'billing_cycle'

        await this.db
          .update(schema.PlanSubscription)
          .set({
            status: updatedStripeSubscription.status,
            billingCycle: input.billingCycle,
            seats: input.seats,
            periodStart: new Date(firstItem.current_period_start * 1000),
            periodEnd: new Date(firstItem.current_period_end * 1000),
            cancelAtPeriodEnd: updatedStripeSubscription.cancel_at_period_end,
            updatedAt: new Date(),
            // Handle trial→paid conversion
            ...(isTrialConversion
              ? {
                  hasTrialEnded: true,
                  trialConversionStatus: 'CONVERTED_TO_PAID' as const,
                  isEligibleForTrial: false,
                  trialEligibilityReason: 'Already converted from trial',
                }
              : {}),
          })
          .where(eq(schema.PlanSubscription.id, currentSubscription.id))

        // Record subscription history
        await this.recordSubscriptionChange({
          subscriptionId: currentSubscription.id,
          organizationId: input.organizationId,
          userId: input.userId,
          changeType,
          fromPlan: currentSubscription.plan?.name,
          toPlan: currentSubscription.plan?.name,
          fromBillingCycle: currentSubscription.billingCycle,
          toBillingCycle: input.billingCycle,
          fromSeats: currentSubscription.seats,
          toSeats: input.seats,
          immediate: true,
        })

        return {
          success: true,
          subscriptionId: currentSubscription.id,
          immediate: true,
        }
      }
    }

    throw new BillingError(ErrorCode.SUBSCRIPTION_NOT_FOUND)
  }

  /**
   * Updates the Stripe customer default payment method when a new method is supplied.
   */
  private async setCustomerDefaultPaymentMethod(
    stripe: Stripe,
    customerId: string | null | undefined,
    paymentMethodId?: string
  ) {
    if (!customerId || !paymentMethodId) {
      return
    }

    try {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      })
    } catch (error) {
      logger.error('Failed to update customer default payment method', {
        customerId,
        paymentMethodId,
        error,
      })
    }
  }

  /**
   * Detaches an obsolete payment method when it no longer needs to remain on the customer.
   */
  private async detachPreviousPaymentMethod(
    stripe: Stripe,
    previousPaymentMethodId?: string,
    nextPaymentMethodId?: string
  ) {
    if (!previousPaymentMethodId || previousPaymentMethodId === nextPaymentMethodId) {
      return
    }

    try {
      await stripe.paymentMethods.detach(previousPaymentMethodId)
      logger.info('Detached obsolete payment method', {
        previousPaymentMethodId,
      })
    } catch (error) {
      logger.error('Failed to detach obsolete payment method', {
        previousPaymentMethodId,
        error,
      })
    }
  }

  /**
   * Records a subscription change in the history table for audit purposes.
   */
  private async recordSubscriptionChange(params: {
    subscriptionId: string
    organizationId: string
    userId?: string
    changeType: string
    fromPlan?: string
    toPlan?: string
    fromBillingCycle?: 'MONTHLY' | 'ANNUAL'
    toBillingCycle?: 'MONTHLY' | 'ANNUAL'
    fromSeats?: number
    toSeats?: number
    immediate: boolean
    scheduledFor?: Date
    prorationAmount?: number
  }): Promise<void> {
    // Skip recording if no userId (for backwards compatibility)
    if (!params.userId) {
      logger.debug('Skipping history recording - no userId provided')
      return
    }

    try {
      await this.db.insert(schema.PlanSubscriptionHistory).values({
        subscriptionId: params.subscriptionId,
        organizationId: params.organizationId,
        userId: params.userId,
        changeType: params.changeType,
        fromPlan: params.fromPlan ?? null,
        toPlan: params.toPlan ?? null,
        fromBillingCycle: params.fromBillingCycle ?? null,
        toBillingCycle: params.toBillingCycle ?? null,
        fromSeats: params.fromSeats ?? null,
        toSeats: params.toSeats ?? null,
        immediate: params.immediate,
        scheduledFor: params.scheduledFor ?? null,
        appliedAt: params.immediate ? new Date() : null,
        prorationAmount: params.prorationAmount ?? null,
      })

      logger.info('Subscription change recorded', {
        subscriptionId: params.subscriptionId,
        changeType: params.changeType,
      })
    } catch (error) {
      // Log but don't fail the main operation if history recording fails
      logger.error('Failed to record subscription change', {
        subscriptionId: params.subscriptionId,
        changeType: params.changeType,
        error,
      })
    }
  }

  /**
   * Looks up the organization's active or trialing subscription from the database.
   *
   * @param organizationId Identifier of the organization whose subscription is required.
   * @returns Matching active or trialing subscription record when found; otherwise `undefined`.
   */
  private async findActiveSubscription(organizationId: string) {
    return await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq, and, or }) =>
        and(
          eq(sub.organizationId, organizationId),
          or(eq(sub.status, 'active'), eq(sub.status, 'trialing'))
        ),
    })
  }
}

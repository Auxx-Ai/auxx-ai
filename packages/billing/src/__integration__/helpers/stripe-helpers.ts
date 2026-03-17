// packages/billing/src/__integration__/helpers/stripe-helpers.ts
/**
 * Stripe test helpers for integration tests.
 * Creates real Stripe resources (test mode) for end-to-end billing validation.
 */

import type Stripe from 'stripe'

const TEST_SUITE_MARKER = 'billing_integration'
export const TEST_PREFIX = 'billing_test_'

export interface StripePlanIds {
  starter: {
    productId: string
    monthlyPriceId: string
    annualPriceId: string
  }
  pro: {
    productId: string
    monthlyPriceId: string
    annualPriceId: string
  }
  enterprise: {
    productId: string
    monthlyPriceId: string
    annualPriceId: string
  }
}

interface PlanDef {
  name: string
  monthly: number
  annual: number
}

const PLAN_DEFS: PlanDef[] = [
  { name: 'billing_test_starter', monthly: 2900, annual: 29000 },
  { name: 'billing_test_pro', monthly: 7900, annual: 79000 },
  { name: 'billing_test_enterprise', monthly: 19900, annual: 199000 },
]

/**
 * Create test Stripe products and prices (idempotent).
 * Looks up by metadata before creating. Returns price IDs for DB seeding.
 */
export async function createTestStripePlans(stripe: Stripe): Promise<StripePlanIds> {
  const result: Record<
    string,
    { productId: string; monthlyPriceId: string; annualPriceId: string }
  > = {}

  for (const plan of PLAN_DEFS) {
    // Find or create product by metadata
    const existing = await stripe.products.search({
      query: `metadata['testSuite']:'${TEST_SUITE_MARKER}' AND metadata['planName']:'${plan.name}'`,
    })
    let product = existing.data[0]

    if (!product) {
      product = await stripe.products.create({
        name: plan.name,
        metadata: { testSuite: TEST_SUITE_MARKER, planName: plan.name },
      })
    }

    // Find or create monthly price
    const monthlyPriceId = await findOrCreatePrice(
      stripe,
      product.id,
      plan.name,
      'monthly',
      plan.monthly
    )

    // Find or create annual price
    const annualPriceId = await findOrCreatePrice(
      stripe,
      product.id,
      plan.name,
      'annual',
      plan.annual
    )

    const key = plan.name.replace('billing_test_', '')
    result[key] = {
      productId: product.id,
      monthlyPriceId,
      annualPriceId,
    }
  }

  return result as StripePlanIds
}

async function findOrCreatePrice(
  stripe: Stripe,
  productId: string,
  planName: string,
  interval: 'monthly' | 'annual',
  amount: number
): Promise<string> {
  const lookupKey = `${planName}_${interval}`

  // Search by lookup_key
  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  })

  if (prices.data[0]) {
    return prices.data[0].id
  }

  // Create new price
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: 'usd',
    recurring: { interval: interval === 'annual' ? 'year' : 'month' },
    lookup_key: lookupKey,
  })

  return price.id
}

/** Create a test clock frozen at a given date. */
export async function createTestClock(
  stripe: Stripe,
  frozenTime?: Date
): Promise<Stripe.TestHelpers.TestClock> {
  const frozen = frozenTime ?? new Date('2025-01-01T00:00:00Z')
  return stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(frozen.getTime() / 1000),
    name: `${TEST_PREFIX}clock_${Date.now()}`,
  })
}

/**
 * Create a customer attached to a test clock.
 * Attaches a test payment method and sets it as default.
 */
export async function createTestCustomer(
  stripe: Stripe,
  clockId: string,
  opts?: {
    email?: string
    paymentMethod?: string
  }
): Promise<{ customer: Stripe.Customer; paymentMethodId: string }> {
  const email = opts?.email ?? `billing-test-${Date.now()}@test.auxx.ai`
  const pmToken = opts?.paymentMethod ?? 'pm_card_visa'

  const customer = await stripe.customers.create({
    email,
    test_clock: clockId,
    metadata: { testSuite: TEST_SUITE_MARKER },
  })

  // Attach payment method
  const pm = await stripe.paymentMethods.attach(pmToken, { customer: customer.id })

  // Set as default
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  })

  return { customer, paymentMethodId: pm.id }
}

/**
 * Create a subscription on a test-clock customer.
 * Sets metadata.subscriptionId and metadata.organizationId for webhook lookup.
 */
export async function createTestSubscription(
  stripe: Stripe,
  customerId: string,
  priceId: string,
  opts?: {
    trialDays?: number
    seats?: number
    metadata?: { subscriptionId: string; organizationId: string }
  }
): Promise<Stripe.Subscription> {
  const params: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceId, quantity: opts?.seats ?? 1 }],
    metadata: opts?.metadata ?? {},
    payment_behavior: 'allow_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    expand: ['latest_invoice.payment_intent'],
  }

  if (opts?.trialDays) {
    params.trial_period_days = opts.trialDays
  }

  return stripe.subscriptions.create(params)
}

/**
 * Advance clock and poll until 'ready'. Throws on 'internal_failure'.
 * Returns when all Stripe processes triggered by the advance are complete.
 */
export async function advanceClockAndWait(
  stripe: Stripe,
  clockId: string,
  frozenTime: Date,
  pollIntervalMs = 2000
): Promise<Stripe.TestHelpers.TestClock> {
  await stripe.testHelpers.testClocks.advance(clockId, {
    frozen_time: Math.floor(frozenTime.getTime() / 1000),
  })

  // Poll until clock is ready
  let clock: Stripe.TestHelpers.TestClock
  const maxAttempts = 60 // 2 min with 2s interval
  let attempts = 0

  do {
    await sleep(pollIntervalMs)
    clock = await stripe.testHelpers.testClocks.retrieve(clockId)
    attempts++

    if (clock.status === 'internal_failure') {
      throw new Error(`Test clock ${clockId} failed with internal_failure`)
    }

    if (attempts >= maxAttempts) {
      throw new Error(
        `Test clock ${clockId} did not reach 'ready' within ${maxAttempts * pollIntervalMs}ms`
      )
    }
  } while (clock.status === 'advancing')

  return clock
}

/** Delete test clock (safe if already deleted). */
export async function deleteTestClock(stripe: Stripe, clockId: string): Promise<void> {
  try {
    await stripe.testHelpers.testClocks.del(clockId)
  } catch {
    // Already deleted or doesn't exist
  }
}

/** Swap a customer's default payment method mid-test. */
export async function swapPaymentMethod(
  stripe: Stripe,
  customerId: string,
  subscriptionId: string,
  newPaymentMethod: string
): Promise<string> {
  const pm = await stripe.paymentMethods.attach(newPaymentMethod, { customer: customerId })

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  })

  await stripe.subscriptions.update(subscriptionId, {
    default_payment_method: pm.id,
  })

  return pm.id
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

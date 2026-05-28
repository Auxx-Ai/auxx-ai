// packages/billing/src/services/preview-base.ts

import type { schema } from '@auxx/database'

type Plan = typeof schema.Plan.$inferSelect
type PlanSubscription = typeof schema.PlanSubscription.$inferSelect

export type PreviewTransition =
  | 'renewal'
  | 'upgrade'
  | 'downgrade'
  | 'seat_addition'
  | 'seat_reduction'
  | 'switch_to_annual'
  | 'switch_to_monthly'
  | 'trial_to_paid'

export interface PreviewLineItem {
  description: string
  amount: number
  quantity: number
  billing_product_id: string
  billing_product_price_id: string | null
}

export interface PreviewRenewal {
  currency: string
  total: number
  total_excluding_tax: number
  subtotal: number
  tax: number
  line_items: PreviewLineItem[]
  discount: number
  discount_metadata: null
  billing_starts?: Date | null
}

export interface ComputePlanPreviewBaseInput {
  currentSubscription: (PlanSubscription & { plan?: Plan | null }) | null
  targetPlan: Plan
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats: number
}

export interface ComputePlanPreviewBaseResult {
  transition: PreviewTransition
  isTrialing: boolean
  isSeatIncrease: boolean
  isSeatDecrease: boolean
  /** Per-cycle subtotal in major units (e.g. dollars). */
  subtotalMajor: number
  /** Per-cycle tax in major units. */
  taxMajor: number
  /** Per-cycle total in major units. */
  totalMajor: number
  renewal: PreviewRenewal
}

/**
 * Provider-agnostic Layer 1 of subscription preview computation.
 *
 * Computes the renewal line items, subtotal/tax/total, and detects the transition kind
 * (upgrade vs downgrade vs seat change vs cycle change vs trial-to-paid).
 *
 * Layer 2 — exact proration ("due today" / "credit applied") — is provider-specific and
 * left to the caller (Stripe enriches via `stripe.invoices.createPreview`; Shopify has
 * no preview API and returns `proration: null`).
 */
export function computePlanPreviewBase(
  input: ComputePlanPreviewBaseInput
): ComputePlanPreviewBaseResult {
  const { currentSubscription, targetPlan, billingCycle, seats } = input
  const price = billingCycle === 'MONTHLY' ? targetPlan.monthlyPrice : targetPlan.annualPrice
  const subtotal = (price * seats) / 100
  const tax = 0
  const total = subtotal + tax

  const isTrialing = currentSubscription?.status === 'trialing'
  const isSamePlan = !!currentSubscription && currentSubscription.planId === targetPlan.id
  const isSameBillingCycle =
    !!currentSubscription && currentSubscription.billingCycle === billingCycle
  const currentSeats = currentSubscription?.seats ?? 0
  const isSeatIncrease = seats > currentSeats
  const isSeatDecrease = seats < currentSeats

  let transition: PreviewTransition = 'renewal'
  if (currentSubscription?.plan) {
    const currentPlanLevel = currentSubscription.plan.hierarchyLevel
    const targetPlanLevel = targetPlan.hierarchyLevel
    if (targetPlanLevel > currentPlanLevel) {
      transition = 'upgrade'
    } else if (targetPlanLevel < currentPlanLevel) {
      transition = 'downgrade'
    } else if (isSamePlan && isSameBillingCycle && isSeatIncrease) {
      transition = 'seat_addition'
    } else if (isSamePlan && isSameBillingCycle && isSeatDecrease) {
      transition = 'seat_reduction'
    } else if (!isSameBillingCycle) {
      transition = billingCycle === 'ANNUAL' ? 'switch_to_annual' : 'switch_to_monthly'
    }
  }

  if (isTrialing) {
    transition = 'trial_to_paid'
  }

  const billingStarts =
    isTrialing && currentSubscription?.trialEnd ? currentSubscription.trialEnd : null

  const renewal: PreviewRenewal = {
    currency: 'USD',
    total: Math.round(total * 100),
    total_excluding_tax: Math.round(subtotal * 100),
    subtotal: Math.round(subtotal * 100),
    tax: Math.round(tax * 100),
    line_items: [
      {
        description: `${seats} seat × ${targetPlan.name} (at $${(price / 100).toFixed(2)} / ${billingCycle === 'MONTHLY' ? 'month' : 'year'})`,
        amount: Math.round(subtotal * 100),
        quantity: seats,
        billing_product_id: `seat_${targetPlan.name.toLowerCase()}`,
        billing_product_price_id:
          billingCycle === 'MONTHLY'
            ? targetPlan.stripePriceIdMonthly
            : targetPlan.stripePriceIdAnnual,
      },
    ],
    discount: 0,
    discount_metadata: null,
    billing_starts: billingStarts,
  }

  return {
    transition,
    isTrialing,
    isSeatIncrease,
    isSeatDecrease,
    subtotalMajor: subtotal,
    taxMajor: tax,
    totalMajor: total,
    renewal,
  }
}

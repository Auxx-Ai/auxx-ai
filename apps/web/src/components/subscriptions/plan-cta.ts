// apps/web/src/components/subscriptions/plan-cta.ts

/** Action behind a plan card's primary button. */
export type PlanCtaAction = 'current' | 'upgrade' | 'downgrade' | 'select' | 'contact'

export interface PlanCta {
  text: string
  action: PlanCtaAction
  /** Shopify redirects leave the app — render an ExternalLink glyph + this loading text. */
  external: boolean
  loadingText: string
}

/**
 * Resolves the copy + action for a plan card's primary button, shared by
 * `PlanCard` and `HorizontalPlanCard` so the two can't drift.
 *
 * Shopify orgs redirect to Shopify's hosted pricing page, which can't pre-select a plan
 * (App Pricing has no documented URL param for it). We keep the relative verb (still
 * meaningful as position) but mark the action external instead of implying an in-app commit.
 */
export function getPlanCta(args: {
  isCustomPricing: boolean
  isCurrentPlan: boolean
  planLevel: number
  currentPlanLevel: number
  isShopify: boolean
}): PlanCta {
  const { isCustomPricing, isCurrentPlan, planLevel, currentPlanLevel, isShopify } = args
  const loadingText = isShopify ? 'Redirecting to Shopify…' : 'Processing…'

  if (isCustomPricing) {
    return { text: 'Contact Sales', action: 'contact', external: false, loadingText }
  }
  if (isCurrentPlan) {
    return { text: 'Current Plan', action: 'current', external: false, loadingText }
  }

  let action: PlanCtaAction = 'select'
  if (currentPlanLevel !== -1 && planLevel > currentPlanLevel) action = 'upgrade'
  else if (currentPlanLevel !== -1 && planLevel < currentPlanLevel) action = 'downgrade'

  const verb = action === 'upgrade' ? 'Upgrade' : action === 'downgrade' ? 'Downgrade' : 'Select'

  return {
    text: isShopify ? `${verb} in Shopify` : `${verb} Plan`,
    action,
    external: isShopify,
    loadingText,
  }
}

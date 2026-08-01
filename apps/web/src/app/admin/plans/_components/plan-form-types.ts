// apps/web/src/app/admin/plans/_components/plan-form-types.ts
/**
 * Shared form data type for plan create/edit forms.
 */
import type { FeatureDefinition } from '@auxx/lib/permissions/client'

export interface PlanFormData {
  name: string
  description: string
  features: string[]
  monthlyPrice: number
  annualPrice: number
  isCustomPricing: boolean
  isFree: boolean
  hasTrial: boolean
  trialDays: number
  featureLimits: FeatureDefinition[]
  trialFeatureLimits: FeatureDefinition[] | null
  hierarchyLevel: number
  selfServed: boolean
  isMostPopular: boolean
  minSeats: number
  maxSeats: number
}

/**
 * Normalize a feature-limit list for the plan write API.
 *
 * Reads can legitimately carry `'+'` — `Plan.featureLimits` is untyped `jsonb` and
 * legacy rows persist the normalized unlimited marker (consumers such as
 * `overage-detection-service` still handle both). The `admin.plans.create`/`update`
 * inputs accept only `number | boolean`, where **-1** is unlimited, so `'+'` must be
 * mapped back before submit or saving a legacy plan is rejected by validation.
 */
export function toWritableFeatureLimits(
  limits: FeatureDefinition[]
): { key: string; limit: number | boolean }[] {
  return limits.map(({ key, limit }) => ({ key, limit: limit === '+' ? -1 : limit }))
}

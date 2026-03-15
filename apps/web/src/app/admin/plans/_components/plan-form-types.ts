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
  hierarchyLevel: number
  selfServed: boolean
  isMostPopular: boolean
  minSeats: number
  maxSeats: number
}

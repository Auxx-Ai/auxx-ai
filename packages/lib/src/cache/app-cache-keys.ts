// packages/lib/src/cache/app-cache-keys.ts

/** Cached plan row (serializable) */
export interface CachedPlan {
  id: string
  name: string
  description: string | null
  features: unknown
  monthlyPrice: number
  annualPrice: number
  isCustomPricing: boolean
  hasTrial: boolean
  trialDays: number
  minSeats: number
  maxSeats: number
  isMostPopular: boolean
  isFree: boolean
  featureLimits: unknown
  trialFeatureLimits: unknown
  stripeProductId: string | null
  stripePriceIdMonthly: string | null
  stripePriceIdAnnual: string | null
  hierarchyLevel: number
  selfServed: boolean
}

/** Serializable workflow template list item (no graph blob) */
export interface CachedWorkflowTemplate {
  id: string
  name: string
  description: string
  categories: string[]
  imgUrl: string | null
  version: number
  status: string
  triggerType: string | null
  popularity: number
  createdAt: string
  updatedAt: string
}

/** All app-wide (non-scoped) cache keys and their data types */
export interface AppCacheDataMap {
  plans: CachedPlan[]
  planMap: Record<string, CachedPlan>
  workflowTemplates: CachedWorkflowTemplate[]
}

export type AppCacheKeyName = keyof AppCacheDataMap

const ONE_DAY = 86400
const ONE_HOUR = 3600

/** Key configuration: prefix for Redis keys and TTL */
export const APP_CACHE_KEY_CONFIG: Record<AppCacheKeyName, { prefix: string; ttlSeconds: number }> =
  {
    plans: { prefix: 'app:plans', ttlSeconds: ONE_DAY },
    planMap: { prefix: 'app:plan-map', ttlSeconds: ONE_DAY },
    workflowTemplates: { prefix: 'app:wf-templates', ttlSeconds: ONE_HOUR },
  }

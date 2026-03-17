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

/** Cached app row (JSON-serializable, no relations) */
export interface CachedApp {
  id: string
  slug: string
  title: string
  description: string | null
  avatarId: string | null
  avatarUrl: string | null
  screenshots: string[]
  category: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  supportSiteUrl: string | null
  termsOfServiceUrl: string | null
  overview: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null
  scopes: string[]
  hasOauth: boolean
  hasBundle: boolean
  oauthExternalEntrypointUrl: string | null
  publicationStatus: string
  reviewStatus: string | null
  verified: boolean
  autoApprove: boolean
  developerAccountId: string
  createdAt: string
  updatedAt: string
}

/** Published app with developer info for marketplace listing */
export interface CachedPublishedApp {
  id: string
  slug: string
  title: string
  description: string | null
  avatarId: string | null
  avatarUrl: string | null
  category: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  supportSiteUrl: string | null
  termsOfServiceUrl: string | null
  overview: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null
  scopes: string[]
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null
  verified: boolean
  developerAccount: {
    title: string
    logoUrl: string | null
  }
  latestDeployment: {
    id: string
    version: string | null
    status: string
  } | null
}

/** All app-wide (non-scoped) cache keys and their data types */
export interface AppCacheDataMap {
  plans: CachedPlan[]
  planMap: Record<string, CachedPlan>
  workflowTemplates: CachedWorkflowTemplate[]
  appSlugMap: Record<string, CachedApp>
  publishedApps: CachedPublishedApp[]
}

export type AppCacheKeyName = keyof AppCacheDataMap

const ONE_DAY = 86400
const ONE_HOUR = 3600
const FIFTEEN_MINUTES = 900

/** Key configuration: prefix for Redis keys and TTL */
export const APP_CACHE_KEY_CONFIG: Record<AppCacheKeyName, { prefix: string; ttlSeconds: number }> =
  {
    plans: { prefix: 'app:plans', ttlSeconds: ONE_DAY },
    planMap: { prefix: 'app:plan-map', ttlSeconds: ONE_DAY },
    workflowTemplates: { prefix: 'app:wf-templates', ttlSeconds: ONE_HOUR },
    appSlugMap: { prefix: 'app:slug-map', ttlSeconds: ONE_HOUR },
    publishedApps: { prefix: 'app:published', ttlSeconds: FIFTEEN_MINUTES },
  }

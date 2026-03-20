// packages/lib/src/cache/build-user-cache-keys.ts

/** Cached developer account for build portal */
export interface BuildCachedDeveloperAccount {
  id: string
  title: string
  slug: string
  logoId: string | null
  logoUrl: string | null
  featureFlags: Record<string, boolean> | null
  createdAt: Date
  updatedAt: Date
  userMember: {
    id: string
    userId: string
    accessLevel: 'admin' | 'member'
    createdAt: Date
  }
  members: {
    id: string
    userId: string
    userName: string | null
    userEmail: string | null
    userImage: string | null
    accessLevel: 'admin' | 'member'
    createdAt: Date
  }[]
}

/** Cached app for build portal */
export interface BuildCachedApp {
  id: string
  developerAccountId: string
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
  scopes: string[] | null
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null
  hasBundle: boolean
  publicationStatus: string | null
  createdAt: Date
  updatedAt: Date
}

/** Cached organization for build portal */
export interface BuildCachedOrganization {
  id: string
  name: string | null
  handle: string
  slug: string
}

/** All build-user-scoped cache keys and their data types */
export interface BuildUserCacheDataMap {
  buildDeveloperAccounts: BuildCachedDeveloperAccount[]
  buildApps: BuildCachedApp[]
  buildOrganizations: BuildCachedOrganization[]
}

export type BuildUserCacheKeyName = keyof BuildUserCacheDataMap

const ONE_HOUR = 60 * 60
const ONE_DAY = 60 * 60 * 24

/** Key configuration for build-user-scoped cache */
export const BUILD_USER_CACHE_KEY_CONFIG: Record<
  BuildUserCacheKeyName,
  { prefix: string; ttlSeconds: number }
> = {
  buildDeveloperAccounts: { prefix: 'build:dev-accounts', ttlSeconds: ONE_DAY },
  buildApps: { prefix: 'build:apps', ttlSeconds: ONE_HOUR },
  buildOrganizations: { prefix: 'build:orgs', ttlSeconds: ONE_DAY },
}

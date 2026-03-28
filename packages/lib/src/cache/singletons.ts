// packages/lib/src/cache/singletons.ts

import { AppCacheService } from './app-cache-service'
import { BuildUserCacheService } from './build-user-cache-service'
import { OrganizationCacheService } from './org-cache-service'
import { registerAllProviders } from './register-providers'
import { TokenCacheService } from './token-cache-service'
import { UserCacheService } from './user-cache-service'

/**
 * Use globalThis to persist cache singletons across module re-evaluations.
 * In Next.js with Turbopack, API routes and server components can have separate
 * module scopes. Module-level `let` variables would create isolated instances,
 * causing cache invalidations in one scope (e.g. API route) to not propagate
 * to the other (e.g. server component layout). globalThis is shared across all
 * server bundles within the same Node.js process.
 */
const globalForCache = globalThis as unknown as {
  _auxxAppCache?: AppCacheService
  _auxxBuildUserCache?: BuildUserCacheService
  _auxxOrgCache?: OrganizationCacheService
  _auxxTokenCache?: TokenCacheService
  _auxxUserCache?: UserCacheService
}

/** Initialize all cache services (lazily called on first access) */
function initCaches(): void {
  globalForCache._auxxOrgCache = new OrganizationCacheService()
  globalForCache._auxxUserCache = new UserCacheService()
  globalForCache._auxxAppCache = new AppCacheService()
  globalForCache._auxxBuildUserCache = new BuildUserCacheService()
  registerAllProviders(
    globalForCache._auxxOrgCache,
    globalForCache._auxxUserCache,
    globalForCache._auxxAppCache,
    globalForCache._auxxBuildUserCache
  )
}

/** Get the singleton app-wide cache service (lazily initialized with all providers) */
export function getAppCache(): AppCacheService {
  if (!globalForCache._auxxAppCache) initCaches()
  return globalForCache._auxxAppCache!
}

/** Get the singleton org cache service (lazily initialized with all providers) */
export function getOrgCache(): OrganizationCacheService {
  if (!globalForCache._auxxOrgCache) initCaches()
  return globalForCache._auxxOrgCache!
}

/** Get the singleton token cache service for short-lived, one-time-use tokens */
export function getTokenCache(): TokenCacheService {
  if (!globalForCache._auxxTokenCache) {
    globalForCache._auxxTokenCache = new TokenCacheService()
  }
  return globalForCache._auxxTokenCache
}

/** Get the singleton user cache service (lazily initialized with all providers) */
export function getUserCache(): UserCacheService {
  if (!globalForCache._auxxUserCache) initCaches()
  return globalForCache._auxxUserCache!
}

/** Get the singleton build user cache service (lazily initialized with all providers) */
export function getBuildUserCache(): BuildUserCacheService {
  if (!globalForCache._auxxBuildUserCache) initCaches()
  return globalForCache._auxxBuildUserCache!
}

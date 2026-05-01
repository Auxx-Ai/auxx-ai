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
  /**
   * Last provider-registration version applied to the persisted singletons.
   * Bump `PROVIDERS_VERSION` whenever a new cache key + provider is added so
   * HMR re-runs registration on the existing singleton instead of failing
   * with `No provider registered for cache key: <name>` until restart.
   */
  _auxxCacheProvidersVersion?: number
}

/**
 * Bump this whenever `register-providers.ts` adds a new cache key/provider.
 * The next access to a singleton sees the mismatch and re-runs registration.
 */
const PROVIDERS_VERSION = 2

/** Initialize all cache services (lazily called on first access) */
function initCaches(): void {
  globalForCache._auxxOrgCache = new OrganizationCacheService()
  globalForCache._auxxUserCache = new UserCacheService()
  globalForCache._auxxAppCache = new AppCacheService()
  globalForCache._auxxBuildUserCache = new BuildUserCacheService()
  registerProvidersOnExisting()
}

/**
 * Re-run provider registration against the existing singletons when the
 * compiled-in `PROVIDERS_VERSION` differs from the version last applied.
 * `register()` is an idempotent `Map.set` so re-runs are safe; gating by
 * version avoids paying the cost on every singleton access in steady state.
 */
function ensureProvidersUpToDate(): void {
  if (globalForCache._auxxCacheProvidersVersion === PROVIDERS_VERSION) return
  registerProvidersOnExisting()
}

function registerProvidersOnExisting(): void {
  registerAllProviders(
    globalForCache._auxxOrgCache!,
    globalForCache._auxxUserCache!,
    globalForCache._auxxAppCache!,
    globalForCache._auxxBuildUserCache!
  )
  globalForCache._auxxCacheProvidersVersion = PROVIDERS_VERSION
}

/** Get the singleton app-wide cache service (lazily initialized with all providers) */
export function getAppCache(): AppCacheService {
  if (!globalForCache._auxxAppCache) initCaches()
  else ensureProvidersUpToDate()
  return globalForCache._auxxAppCache!
}

/** Get the singleton org cache service (lazily initialized with all providers) */
export function getOrgCache(): OrganizationCacheService {
  if (!globalForCache._auxxOrgCache) initCaches()
  else ensureProvidersUpToDate()
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
  else ensureProvidersUpToDate()
  return globalForCache._auxxUserCache!
}

/** Get the singleton build user cache service (lazily initialized with all providers) */
export function getBuildUserCache(): BuildUserCacheService {
  if (!globalForCache._auxxBuildUserCache) initCaches()
  else ensureProvidersUpToDate()
  return globalForCache._auxxBuildUserCache!
}

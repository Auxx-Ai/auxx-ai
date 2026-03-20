// packages/lib/src/cache/singletons.ts

import { AppCacheService } from './app-cache-service'
import { BuildUserCacheService } from './build-user-cache-service'
import { OrganizationCacheService } from './org-cache-service'
import { registerAllProviders } from './register-providers'
import { TokenCacheService } from './token-cache-service'
import { UserCacheService } from './user-cache-service'

let appCacheInstance: AppCacheService | undefined
let buildUserCacheInstance: BuildUserCacheService | undefined
let orgCacheInstance: OrganizationCacheService | undefined
let tokenCacheInstance: TokenCacheService | undefined
let userCacheInstance: UserCacheService | undefined

/** Initialize all cache services (lazily called on first access) */
function initCaches(): void {
  orgCacheInstance = new OrganizationCacheService()
  userCacheInstance = new UserCacheService()
  appCacheInstance = new AppCacheService()
  buildUserCacheInstance = new BuildUserCacheService()
  registerAllProviders(
    orgCacheInstance,
    userCacheInstance,
    appCacheInstance,
    buildUserCacheInstance
  )
}

/** Get the singleton app-wide cache service (lazily initialized with all providers) */
export function getAppCache(): AppCacheService {
  if (!appCacheInstance) initCaches()
  return appCacheInstance!
}

/** Get the singleton org cache service (lazily initialized with all providers) */
export function getOrgCache(): OrganizationCacheService {
  if (!orgCacheInstance) initCaches()
  return orgCacheInstance!
}

/** Get the singleton token cache service for short-lived, one-time-use tokens */
export function getTokenCache(): TokenCacheService {
  if (!tokenCacheInstance) tokenCacheInstance = new TokenCacheService()
  return tokenCacheInstance
}

/** Get the singleton user cache service (lazily initialized with all providers) */
export function getUserCache(): UserCacheService {
  if (!userCacheInstance) initCaches()
  return userCacheInstance!
}

/** Get the singleton build user cache service (lazily initialized with all providers) */
export function getBuildUserCache(): BuildUserCacheService {
  if (!buildUserCacheInstance) initCaches()
  return buildUserCacheInstance!
}

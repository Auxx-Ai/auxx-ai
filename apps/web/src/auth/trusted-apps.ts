// apps/web/src/auth/trusted-apps.ts

import { DEV_PORTAL_URL } from '@auxx/config/server'

/** Known satellite apps that can receive login tokens */
export type TrustedAppId = 'build'

/** Registry of satellite app IDs to their origin URLs */
const TRUSTED_APP_ORIGINS: Record<TrustedAppId, string> = {
  build: DEV_PORTAL_URL,
  // Add future satellite apps here
}

/** Resolve a trusted app ID to its origin URL */
export function getTrustedAppOrigin(appId: string): string | null {
  return TRUSTED_APP_ORIGINS[appId as TrustedAppId] ?? null
}

/** Check if an app ID is registered */
export function isTrustedApp(appId: string): boolean {
  return appId in TRUSTED_APP_ORIGINS
}

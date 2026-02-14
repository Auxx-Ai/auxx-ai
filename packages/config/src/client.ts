// packages/config/src/client.ts

import { clientEnv } from './client-env'

export { clientEnv as env } from './client-env'
export { constants, RESERVED_API_SLUGS, type ReservedApiSlug } from './constants'
export {
  CURRENCIES,
  type Currency,
  type CurrencyCode,
  getCurrency,
  getCurrencySymbol,
  isValidCurrency,
} from './currencies'
export { features } from './features'
export { detectTimezone, IANA_TIME_ZONES, type IANATimeZone, isValidTimezone } from './timezones'

export * from './url'

/** Returns build metadata for display in UI and debugging */
export function getAppVersion() {
  return {
    version: clientEnv.NEXT_PUBLIC_APP_VERSION || 'dev',
    sha: clientEnv.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) || 'local',
    buildTime: clientEnv.NEXT_PUBLIC_BUILD_TIME || null,
  }
}

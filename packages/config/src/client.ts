// packages/config/src/client.ts

import { clientEnv } from './client-env'

export { features } from './features'
export { constants, RESERVED_API_SLUGS, type ReservedApiSlug } from './constants'
export { clientEnv as env } from './client-env'

export { IANA_TIME_ZONES, detectTimezone, isValidTimezone, type IANATimeZone } from './timezones'

export {
  CURRENCIES,
  getCurrency,
  getCurrencySymbol,
  isValidCurrency,
  type Currency,
  type CurrencyCode,
} from './currencies'

export * from './url'

/** Returns build metadata for display in UI and debugging */
export function getAppVersion() {
  return {
    version: clientEnv.NEXT_PUBLIC_APP_VERSION || 'dev',
    sha: clientEnv.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) || 'local',
    buildTime: clientEnv.NEXT_PUBLIC_BUILD_TIME || null,
  }
}

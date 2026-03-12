// packages/config/src/client.ts

export {
  constants,
  RESERVED_API_SLUGS,
  RESERVED_ORGANIZATION_HANDLES,
  type ReservedApiSlug,
  type ReservedOrganizationHandle,
} from './constants'
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
    version: process.env.APP_VERSION || 'dev',
    sha: process.env.GIT_SHA?.slice(0, 7) || 'local',
    buildTime: process.env.BUILD_TIME || null,
  }
}

// packages/config/src/build.ts

// Build-safe config exports for tooling and build-time consumers.
// Do not export runtime loaders from this entrypoint.
export * from './url'
export {
  constants,
  RESERVED_API_SLUGS,
  RESERVED_ORGANIZATION_HANDLES,
  type ReservedApiSlug,
  type ReservedOrganizationHandle,
} from './constants'
export { IANA_TIME_ZONES, detectTimezone, isValidTimezone, type IANATimeZone } from './timezones'
export {
  CURRENCIES,
  getCurrency,
  getCurrencySymbol,
  isValidCurrency,
  type Currency,
  type CurrencyCode,
} from './currencies'
export { features } from './features'

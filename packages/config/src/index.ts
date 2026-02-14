// export const env = process.env.NEXT_RUNTIME === 'nodejs' ? require('./env').env : ({} as const)
// console.log('env', process.env.NEXT_RUNTIME)
// export { env } from './test'
// export { themes } from './themes';

// Export constants
export {
  constants,
  RESERVED_API_SLUGS,
  RESERVED_ORGANIZATION_HANDLES,
  type ReservedApiSlug,
  type ReservedOrganizationHandle,
} from './constants'
export { env } from './env'
// Export SST resource helpers
export { getSecret, getSecrets } from './sst-resources'
// Export timezone utilities
export { detectTimezone, IANA_TIME_ZONES, type IANATimeZone, isValidTimezone } from './timezones'

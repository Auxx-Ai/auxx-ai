// export const env = process.env.NEXT_RUNTIME === 'nodejs' ? require('./env').env : ({} as const)
// console.log('env', process.env.NEXT_RUNTIME)
// export { env } from './test'
// export { themes } from './themes';

// Export SST resource helpers
export { getSecrets, getSecret } from './sst-resources'
export { env } from './env'

// Export timezone utilities
export { IANA_TIME_ZONES, detectTimezone, isValidTimezone, type IANATimeZone } from './timezones'

// Export constants
export {
  constants,
  RESERVED_API_SLUGS,
  RESERVED_ORGANIZATION_HANDLES,
  type ReservedApiSlug,
  type ReservedOrganizationHandle,
} from './constants'

// packages/utils/src/net/index.ts

export { isBlockedAddress, isOutboundAddressAllowed } from './private-address'
export {
  BlockedAddressError,
  guardedLookup,
  type SafeFetchInit,
  safeDispatcher,
  safeFetch,
  UnsafeUrlError,
} from './safe-fetch'

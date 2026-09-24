// packages/lib/src/net/index.ts

export { isBlockedAddress, isOutboundAddressAllowed } from './private-address'
export {
  BlockedAddressError,
  type ResolvedPublicHost,
  resolvePublicHost,
  type SafeFetchInit,
  safeDispatcher,
  safeFetch,
} from './safe-fetch'

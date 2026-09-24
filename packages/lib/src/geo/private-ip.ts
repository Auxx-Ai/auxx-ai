// packages/lib/src/geo/private-ip.ts

import { isBlockedAddress } from '../net/private-address'

/** True for IPs with no useful geo answer (private, loopback, reserved, invalid), so `lookupIp` skips them. */
export function isPrivateIp(ip: string): boolean {
  return isBlockedAddress(ip)
}

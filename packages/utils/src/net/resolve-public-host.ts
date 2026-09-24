// packages/utils/src/net/resolve-public-host.ts

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isOutboundAddressAllowed } from './private-address'
import { BlockedAddressError } from './safe-fetch'

/** A tenant-supplied host vetted for a raw TCP client: dial `address`, keep `servername` for TLS. */
export interface ResolvedPublicHost {
  address: string
  servername: string | undefined
}

/**
 * Resolve `host` and refuse it if any answer is a disallowed address. Connecting to the
 * returned address (not the name) closes the DNS-rebinding window.
 */
export async function resolvePublicHost(host: string): Promise<ResolvedPublicHost> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare)) {
    if (!isOutboundAddressAllowed(bare)) throw new BlockedAddressError(bare)
    return { address: bare, servername: undefined }
  }
  const answers = await lookup(bare, { all: true })
  const bad = answers.find((a) => !isOutboundAddressAllowed(a.address))
  if (bad) throw new BlockedAddressError(bad.address)
  const first = answers[0]
  if (!first) throw new Error(`No address for ${bare}`)
  return { address: first.address, servername: bare }
}

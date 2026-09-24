// packages/lib/src/net/safe-fetch.ts

import { lookup } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'
import { BadRequestError } from '../errors'
import { isOutboundAddressAllowed } from './private-address'

const DEFAULT_TIMEOUT_MS = 30_000

/** A server-side request tried to reach a private, loopback or reserved address. */
export class BlockedAddressError extends BadRequestError {
  constructor(address: string) {
    super(`Refusing to connect to a private or reserved address (${address})`, { address })
  }
}

/** DNS lookup that fails if any answer is disallowed, so the vetted address is the one dialled. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '')
    const bad = addresses.find((a) => !isOutboundAddressAllowed(a.address))
    if (bad) return callback(new BlockedAddressError(bad.address), '')
    if (options.all) return callback(null, addresses)
    const first = addresses[0]
    if (!first) return callback(new Error(`No address for ${hostname}`), '')
    callback(null, first.address, first.family)
  })
}

const baseConnect = buildConnector({ lookup: guardedLookup })

/** Shared dispatcher for any outbound request to a user- or tenant-supplied URL. */
export const safeDispatcher = new Agent({
  connect: (options, callback) => {
    // net.connect skips `lookup` for IP hosts, so literals (including redirect targets) are checked here.
    const host = options.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !isOutboundAddressAllowed(host)) {
      callback(new BlockedAddressError(host), null)
      return
    }
    baseConnect(options, callback)
  },
})

export type SafeFetchInit = RequestInit & { timeoutMs?: number }

function parseHttpUrl(url: string | URL): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BadRequestError(`Invalid URL: ${String(url)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestError(`Unsupported protocol: ${parsed.protocol}`)
  }
  return parsed
}

function findBlocked(error: unknown): BlockedAddressError | null {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof BlockedAddressError) return current
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/**
 * `fetch` through {@link safeDispatcher}, with a whole-request timeout (default 30 s).
 * Rejects with {@link BlockedAddressError} when any hop resolves to a disallowed address.
 */
export async function safeFetch(url: string | URL, init: SafeFetchInit = {}): Promise<Response> {
  const parsed = parseHttpUrl(url)
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await undiciFetch(parsed, {
      ...(rest as Parameters<typeof undiciFetch>[1]),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      dispatcher: safeDispatcher,
    })
    return response as unknown as Response
  } catch (error) {
    throw findBlocked(error) ?? error
  }
}

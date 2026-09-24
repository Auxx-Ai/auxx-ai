// packages/lib/src/net/safe-fetch.ts

import {
  BlockedAddressError as BaseBlockedAddressError,
  safeFetch as baseSafeFetch,
  type SafeFetchInit,
  UnsafeUrlError,
} from '@auxx/utils/net'
import { BadRequestError } from '../errors'

export { guardedLookup, type SafeFetchInit, safeDispatcher } from '@auxx/utils/net'

/** A server-side request tried to reach a private, loopback or reserved address. */
export class BlockedAddressError extends BadRequestError {
  constructor(address: string) {
    super(`Refusing to connect to a private or reserved address (${address})`, { address })
  }
}

/**
 * `@auxx/utils/net`'s `safeFetch`, with its errors mapped to `AuxxError`s so routers answer 400.
 * Rejects with {@link BlockedAddressError} when any hop resolves to a disallowed address.
 */
export async function safeFetch(url: string | URL, init?: SafeFetchInit): Promise<Response> {
  try {
    return await baseSafeFetch(url, init)
  } catch (error) {
    if (error instanceof BaseBlockedAddressError) throw new BlockedAddressError(error.address)
    if (error instanceof UnsafeUrlError) throw new BadRequestError(error.message)
    throw error
  }
}

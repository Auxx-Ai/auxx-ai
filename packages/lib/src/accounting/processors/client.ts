// packages/lib/src/accounting/processors/client.ts
//
// Client-safe: no `'use client'` directive, because server code imports this too.

import { normaliseGatewayHandle } from '../rails/client'
import { AFFIRM_PROCESSOR } from './affirm/client'
import { AUTHORIZE_NET_PROCESSOR } from './authorize-net/client'
import { SHOPIFY_PAYMENTS_PROCESSOR } from './shopify-payments/client'
import { STRIPE_CONNECT_PROCESSOR } from './stripe-connect/client'
import type { ProcessorDescriptor, ProviderPayoutState } from './types'

/** Every processor auxx can read, one per non-`manual` settlement source. */
export const PROCESSORS: readonly ProcessorDescriptor[] = [
  STRIPE_CONNECT_PROCESSOR,
  SHOPIFY_PAYMENTS_PROCESSOR,
  AFFIRM_PROCESSOR,
  AUTHORIZE_NET_PROCESSOR,
]

const BY_PROVIDER_KEY = new Map(PROCESSORS.map((processor) => [processor.id, processor]))

const BY_HANDLE = new Map(
  PROCESSORS.flatMap((processor) => processor.handles.map((handle) => [handle, processor] as const))
)

/** The processor whose feed carries `providerKey`, or null. */
export function processorByProviderKey(providerKey: string): ProcessorDescriptor | null {
  return BY_PROVIDER_KEY.get(providerKey as ProcessorDescriptor['id']) ?? null
}

/** The processor that settles a gateway handle, in any spelling or case, or null. */
export function processorByHandle(handle: string): ProcessorDescriptor | null {
  return BY_HANDLE.get(normaliseGatewayHandle(handle)) ?? null
}

/**
 * A connector payout's reported status as a ledger state (brief 114 P2). Total: an unknown
 * processor, an empty status or an unlisted one on a fail-open processor reads `in_transit`.
 */
export function providerPayoutState(
  providerKey: string,
  status: string | null | undefined
): ProviderPayoutState {
  const processor = processorByProviderKey(providerKey)
  if (!processor || !status) return 'in_transit'
  return Object.hasOwn(processor.payoutStatuses, status)
    ? processor.payoutStatuses[status]!
    : processor.otherPayoutStatus
}

/** App slugs whose connector reads a processor feed. */
export const FEED_APPS: ReadonlySet<string> = new Set(
  PROCESSORS.flatMap((processor) => (processor.feedApp ? [processor.feedApp] : []))
)

/** The feed app for a gateway's handles: the first handle, in order, whose processor has one. */
export function feedAppForHandles(handles: readonly string[]): string | null {
  for (const handle of handles) {
    const feedApp = processorByHandle(handle)?.feedApp
    if (feedApp) return feedApp
  }
  return null
}

export { AFFIRM_PROCESSOR } from './affirm/client'
export { AUTHORIZE_NET_PROCESSOR } from './authorize-net/client'
export { SHOPIFY_APP_SLUG, SHOPIFY_PAYMENTS_PROCESSOR } from './shopify-payments/client'
export { STRIPE_CONNECT_PROCESSOR } from './stripe-connect/client'
export type {
  ProcessorAccountLabel,
  ProcessorDescriptor,
  ProcessorId,
  ProviderPayoutState,
} from './types'

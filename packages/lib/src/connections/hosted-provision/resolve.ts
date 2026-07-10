// packages/lib/src/connections/hosted-provision/resolve.ts
// Resolves a `hostedProvisionKey` (named on a provider's `PlatformProviderDef`) to its
// `HostedProvisionHandler` implementation. Every case is a lazy `import()` so the connections
// tier never statically depends on a consumer module (e.g. money/) — see hosted-provision-
// connection-type.md §2. Generalize to a registry only when a third consumer appears.

import { NotFoundError } from '../../errors'
import type { HostedProvisionHandler } from './types'

/**
 * Resolve a hosted-provision handler by its key. One `switch` case per consumer, each a lazy
 * `import()` so this module (and everything that imports it) never pulls in consumer code
 * (money/, etc.) unless the case actually runs. Throws `NotFoundError` for an unknown key.
 *
 * Consumers register themselves by adding a case here — e.g. money's Stripe Connect handler:
 *   case 'stripeConnect':
 *     return (await import('../../money/payments/connect')).stripeConnectHandler
 */
export async function resolveHostedProvisionHandler(key: string): Promise<HostedProvisionHandler> {
  switch (key) {
    case 'stripeConnect':
      return (await import('../../money/payments/connect')).stripeConnectHandler
    default:
      throw new NotFoundError(`No hosted-provision handler registered for key "${key}"`)
  }
}

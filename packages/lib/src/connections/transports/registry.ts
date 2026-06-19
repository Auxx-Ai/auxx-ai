// packages/lib/src/connections/transports/registry.ts
// Dispatch a connection's transport kind to its runtime client. Transport-specific
// consumers import the client directly (e.g. `httpTransport`); this registry exists
// for generic consumers that resolve the client from the connection's declared kind
// (the `connectionKinds` / transport class). Only `http` is wired today.

import { httpTransport } from './http'
import { postgresTransport } from './postgres'
import type { Transport, TransportKind } from './types'

/**
 * Resolve the transport client for a kind.
 * @throws when the kind has no implemented client yet (postgres/imap/smtp).
 */
export function transportFor(kind: TransportKind): Transport {
  switch (kind) {
    case 'http':
      return httpTransport
    case 'postgres':
      return postgresTransport
    default:
      throw new Error(`Transport "${kind}" is not implemented yet`)
  }
}

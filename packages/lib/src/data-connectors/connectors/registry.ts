// packages/lib/src/data-connectors/connectors/registry.ts
// connectorFor(type) — the single resolution point. `app:` types route to the
// (lazy) app adapter seam; everything else is a built-in. The orchestrator never
// branches on provider — it calls connectorFor and uses the returned definition.

import { NotFoundError } from '../../errors'
import { type AppConnectorContext, appConnectorAdapter } from './app-connector-adapter'
import { fixtureConnector } from './fixture'
import { genericRestConnector } from './generic-rest'
import {
  STRIPE_FC_CONNECTOR_TYPE,
  stripeFinancialConnectionsConnector,
} from './stripe-financial-connections'
import type { DataConnectorDefinition } from './types'

/** Platform-owned, in-process built-in connectors (not backed by an installed app). */
const BUILTIN_CONNECTORS: Record<string, DataConnectorDefinition> = {
  'generic-rest': genericRestConnector,
  fixture: fixtureConnector,
  // The bank feed. Unlike the two above it drives no HTTP transport at all: it reads
  // the `fca_...` account off its credential and calls the Stripe SDK on the platform
  // key (plans/bank-connection/01). It is still just a built-in here - the orchestrator
  // resolves it through `connectorFor` and never learns what it is.
  [STRIPE_FC_CONNECTOR_TYPE]: stripeFinancialConnectionsConnector,
}

/**
 * Resolve the connector definition for a connector type.
 * - `app:<slug>` → the app-connector adapter — its `fetch` invokes the app's
 *   `execute` export through the app-runtime cluster (lazy-imported). Requires
 *   the connector context (db + org + connector row) so the adapter can resolve
 *   the installed app, its catalog streams, and the borrowed credential.
 * - built-in id (`generic-rest`, `fixture`) → the in-process connector. Built-ins
 *   ignore the context.
 *
 * @throws NotFoundError when the type is neither an app type nor a known built-in.
 */
export function connectorFor(type: string, context?: AppConnectorContext): DataConnectorDefinition {
  if (type.startsWith('app:')) return appConnectorAdapter(type, context)
  const builtin = BUILTIN_CONNECTORS[type]
  if (!builtin) throw new NotFoundError(`Unknown data connector type: ${type}`)
  return builtin
}

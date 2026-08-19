// packages/lib/src/connections/client.ts
//
// Client-safe re-exports from the connections module. `./index.ts` reaches the credential store,
// the provider transports and the database — use this entry in client components, which only
// need the connect-time wire contracts.

export { CONNECTION_SETTLED_EVENT, type ConnectionSettledEvent } from './connect-events'
export type { PendingSelectionKind } from './pending-selection'

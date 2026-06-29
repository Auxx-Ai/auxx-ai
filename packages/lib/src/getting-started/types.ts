// packages/lib/src/getting-started/types.ts
import type { Database, Transaction } from '@auxx/database'

/**
 * Shared context passed into every getting-started function. `db` is optional —
 * when omitted, functions fall back to the singleton `database` export (the
 * settings read/write path and the few cache-omitted DB lookups). Pass a
 * `Transaction` to participate in an existing tx.
 */
export interface GettingStartedContext {
  db?: Database | Transaction
  organizationId: string
}

// packages/lib/src/files/default-database.ts

/**
 * The process-wide database client, read on FIRST USE rather than at import.
 *
 * Lifted verbatim out of `core/base-service.ts` when that file was deleted in
 * PR Y / 5g. It is the one piece of that 582-line class with live consumers, and
 * the reason it is a function rather than a named import is a real hazard, not a
 * style preference:
 *
 * `import { database as db }` is a named binding, and Vitest validates named
 * bindings when the importing module is LINKED. So a test that declares its own
 * `vi.mock('@auxx/database', …)` without a `database` key kills the importing
 * file — and everything downstream of it — at collection with
 * `No "database" export is defined on the "@auxx/database" mock`, before a
 * single test runs. A namespace import has no per-export link check, so the
 * property access below happens only when a caller actually asks for the pool.
 *
 * See `plans/testing/database-mock-collection-hazard.md`.
 *
 * **This is not an invitation to reach for the pool.** Every `files/` function
 * takes its `db` on a {@link ../files/ctx.FilesCtx}; the two remaining callers
 * are `storage/storage-manager.ts` (a facade with no `db` parameter of its own)
 * and `email/inbound/body-ingest.service.ts`. New code passes `ctx`.
 */

import type { Database, Transaction } from '@auxx/database'
// Namespace import, deliberately — see above.
import * as auxxDatabase from '@auxx/database'

/** The app-wide Drizzle client, resolved lazily. */
export function defaultDatabase(): Database | Transaction {
  return auxxDatabase.database
}

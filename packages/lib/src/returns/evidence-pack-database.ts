// packages/lib/src/returns/evidence-pack-database.ts

/**
 * The process-wide database client, read on FIRST USE rather than at import.
 *
 * Needed for exactly one caller: `buildReturnEvidencePackPayload`. The document
 * registry hands every payload builder `(organizationId, userId, recordId)` and
 * no connection, so the evidence pack has nowhere to take a `db` parameter -
 * the same reason every builder in `documents/payload.ts` reaches for the
 * module client. Everything else in `returns/` takes its `db` first and must
 * keep doing so.
 *
 * A namespace import rather than `import { database }`, copying
 * `files/default-database.ts` verbatim and for its reason: Vitest validates
 * NAMED bindings when the importing module is linked, so a test that mocks
 * `@auxx/database` without a `database` key kills this file and everything
 * downstream of it at collection time, before a single test runs. A property
 * access happens only when a caller actually asks for the pool.
 */

import type { Database } from '@auxx/database'
// Namespace import, deliberately - see above.
import * as auxxDatabase from '@auxx/database'

/** The app-wide Drizzle client, resolved lazily. */
export function defaultEvidenceDatabase(): Database {
  return auxxDatabase.database
}

// packages/lib/src/data-deletion/read.ts
//
// Read path for `DataDeletionRequest`. Reads live apart from writes on purpose
// (docs/lib-module-guide.md §5) — a file that both queries and mutates is the
// first step back toward a service class.

import { type Database, type DataDeletionRequestEntity, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from './guard'

/**
 * Look one request up by its public confirmation code — the unauthenticated
 * status page's only query.
 *
 * Returns `ok(null)` rather than a `NotFoundError` for an unknown code: the
 * page must render a neutral "no request found" body with **200**, and must
 * never leak whether a code expired or never existed (plan §4.5).
 */
export async function getDeletionRequestByCode(
  db: Database,
  confirmationCode: string
): Promise<Result<DataDeletionRequestEntity | null, Error>> {
  return guard(async () => {
    const [row] = await db
      .select()
      .from(schema.DataDeletionRequest)
      .where(eq(schema.DataDeletionRequest.confirmationCode, confirmationCode))
      .limit(1)
    return row ?? null
  }, 'Failed to read deletion request by code')
}

/**
 * Load one request by primary key. The job's entry point — `executeDeletionRequest`
 * only ever receives an id over the wire.
 */
export async function getDeletionRequestById(
  db: Database,
  requestId: string
): Promise<Result<DataDeletionRequestEntity | null, Error>> {
  return guard(
    async () => {
      const [row] = await db
        .select()
        .from(schema.DataDeletionRequest)
        .where(eq(schema.DataDeletionRequest.id, requestId))
        .limit(1)
      return row ?? null
    },
    'Failed to read deletion request by id',
    { requestId }
  )
}

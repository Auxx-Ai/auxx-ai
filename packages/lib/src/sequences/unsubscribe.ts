// packages/lib/src/sequences/unsubscribe.ts
// Public, org-agnostic unsubscribe-token resolution (Sequences plan §8) — the
// token IS the capability, same shape as `money/quote-public-token.ts`'s
// `resolveQuoteByPublicToken`, but a direct indexed lookup on
// `SequenceRun.unsubscribeToken` rather than a `FieldValue` scan.

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { exitSequenceRun } from './runtime'
import { upsertSuppression } from './suppression'
import type { UnsubscribePayload } from './types'

/**
 * Minimal, safe payload for the public `/sequences/unsubscribe/{token}` page.
 * Returns `null` on an unknown token (route's `notFound()` trigger).
 */
export async function getUnsubscribePayload(token: string): Promise<UnsubscribePayload | null> {
  if (!token) return null

  const run = await database.query.SequenceRun.findFirst({
    where: eq(schema.SequenceRun.unsubscribeToken, token),
    columns: { organizationId: true, status: true },
  })
  if (!run) return null

  const org = await database.query.Organization.findFirst({
    where: eq(schema.Organization.id, run.organizationId),
    columns: { name: true },
  })

  return {
    organizationName: org?.name ?? null,
    alreadyUnsubscribed: run.status !== 'active',
  }
}

/**
 * Unsubscribe by public token — idempotent. Exits the run (if still active,
 * reason `'unsubscribe'`) then ALWAYS upserts the org-wide suppression row
 * (even if the run had already exited some other way), so a stale/re-clicked
 * link still blocks future enrollments.
 */
export async function unsubscribeByToken(token: string): Promise<Result<void, Error>> {
  const run = await database.query.SequenceRun.findFirst({
    where: eq(schema.SequenceRun.unsubscribeToken, token),
  })
  if (!run) return err(new NotFoundError('Unknown unsubscribe link'))

  if (run.status === 'active') {
    const exitResult = await exitSequenceRun(database, {
      sequenceRunId: run.id,
      organizationId: run.organizationId,
      reason: 'unsubscribe',
    })
    if (exitResult.isErr()) return err(exitResult.error)
  }

  await upsertSuppression(database, {
    organizationId: run.organizationId,
    email: run.recipientEmail,
    contactEntityInstanceId: run.recipientEntityInstanceId,
    reason: 'unsubscribe',
    sequenceRunId: run.id,
  })

  return ok(undefined)
}

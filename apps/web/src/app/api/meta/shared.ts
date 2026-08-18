// apps/web/src/app/api/meta/shared.ts
//
// Shared transport for Meta's two `signed_request` callbacks — the Data
// Deletion Request URL and the Deauthorize Callback URL
// (plans/channels/meta-data-deletion-callback.md §4.3).
//
// The callbacks are APP-level, not platform-level: one Meta app, one app
// secret, and the dashboard has exactly one field for each. So both routes sit
// under `api/meta/` and share this verifier. The existing
// `api/facebook/webhook` and `api/instagram/webhook` routes stay split — those
// are genuinely per-platform Graph subscriptions with a different contract
// (`X-Hub-Signature-256` over the raw body, `metaPreset`), not this one.

import { configService } from '@auxx/credentials'
import { database as db } from '@auxx/database'
import { createDeletionRequest } from '@auxx/lib/data-deletion'
import type { MetaDataDeletionKind } from '@auxx/lib/data-deletion/client'
import { enqueueDataDeletionJob } from '@auxx/lib/jobs'
import { parseSignedRequest } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import type { NextRequest } from 'next/server'

const logger = createScopedLogger('meta-signed-request')

/**
 * Outcome of one callback.
 *
 * - `rejected` — the signature did not verify (or the app secret is missing).
 *   The route answers 4xx/5xx and does NOT fall through: an unverified body is
 *   an attacker asking us to disconnect someone else's channels.
 * - `accepted` — verified. The route answers **200** from here on, whatever
 *   else went wrong, because a 5xx makes Meta retry and a retry storm on a
 *   compliance endpoint is its own incident. `confirmationCode` is null only
 *   when the row could not be written at all.
 */
export type MetaCallbackOutcome =
  | { verified: false; status: 400 | 500; error: string }
  | { verified: true; userId: string; requestId: string; confirmationCode: string }
  | { verified: true; userId: string; requestId: null; confirmationCode: null }

/**
 * Verify a Meta `signed_request` body, record the request, and enqueue its
 * teardown.
 *
 * ### What "their data" is, for the record
 *
 * The id in a Meta deletion callback is the **app-scoped id of the person who
 * authorized the app** — the Auxx admin who connected the Page. It is not the
 * id of a customer who DM'd the Page (those people never authorize the app and
 * cannot trigger this callback; their ids are page-scoped PSIDs, a different
 * keyspace entirely).
 *
 * The personal data we hold *because of that authorization* is: their OAuth
 * access tokens (encrypted, in `Credential`), the Facebook user id and page
 * metadata on `Integration.metadata`, and the app's webhook subscription on
 * their Page. All of it is deleted or revoked.
 *
 * The Messenger and Instagram conversations belong to the **business** whose
 * Page it is — Auxx.ai is the processor, the business is the controller. An
 * admin exercising their own deletion right does not carry a right to erase
 * their employer's customer-support records. A business-level erasure is a
 * separate request, served by org deletion.
 */
export async function handleMetaSignedRequest(
  req: NextRequest,
  kind: MetaDataDeletionKind
): Promise<MetaCallbackOutcome> {
  // 1. Body. `application/x-www-form-urlencoded` with a single field.
  let signedRequest: string | null = null
  try {
    const form = await req.formData()
    const value = form.get('signed_request')
    signedRequest = typeof value === 'string' ? value : null
  } catch (error) {
    logger.warn('Unreadable Meta callback body', { kind, error: describe(error) })
    return { verified: false, status: 400, error: 'Invalid request body' }
  }

  if (!signedRequest) {
    logger.warn('Meta callback without signed_request field', { kind })
    return { verified: false, status: 400, error: 'Missing signed_request' }
  }

  // 2. Signature. A missing app secret is our own misconfiguration, not a bad
  //    request — 500 so a retry after the config is fixed still lands.
  const appSecret = configService.get<string>('FACEBOOK_APP_SECRET')
  if (!appSecret) {
    logger.error('FACEBOOK_APP_SECRET is not configured; cannot verify Meta callback', { kind })
    return { verified: false, status: 500, error: 'Callback not configured' }
  }

  const parsed = parseSignedRequest(signedRequest, appSecret)
  if (parsed.isErr()) {
    // Log and reject, never fall through.
    logger.error('Rejected Meta callback with an invalid signed_request', {
      kind,
      error: parsed.error.message,
    })
    return { verified: false, status: 400, error: 'Invalid signed_request' }
  }

  const { userId } = parsed.value
  logger.info('Verified Meta callback', { kind, userId })

  // 3. Record. Deliberately not deduped on `externalId` — a person may connect,
  //    delete, reconnect and delete again, and each is a real request owed its
  //    own code (plan §7.7).
  let requestId: string
  let confirmationCode: string
  try {
    const created = await createDeletionRequest(db, {
      provider: 'facebook',
      externalId: userId,
      kind,
    })
    if (created.isErr()) throw created.error
    requestId = created.value.id
    confirmationCode = created.value.confirmationCode
  } catch (error) {
    // The request is verified, so we still answer 200 — but it is now only
    // recoverable from this log line, hence `userId` in the payload.
    logger.error('Failed to record a verified Meta callback', {
      kind,
      userId,
      error: describe(error),
    })
    return { verified: true, userId, requestId: null, confirmationCode: null }
  }

  // 4. Teardown, async. The row survives a failed enqueue at `status: 'received'`.
  try {
    await enqueueDataDeletionJob({ requestId })
  } catch (error) {
    logger.error('Failed to enqueue the data-deletion job', {
      kind,
      requestId,
      error: describe(error),
    })
  }

  return { verified: true, userId, requestId, confirmationCode }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

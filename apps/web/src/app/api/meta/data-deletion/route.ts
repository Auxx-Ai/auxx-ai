// apps/web/src/app/api/meta/data-deletion/route.ts
//
// Meta's **Data Deletion Request URL** (App Dashboard → Settings → Basic).
// A hard blocker for App Review: Meta will not let the app be submitted or
// switched to Live without a working one.
//
// Contract (plan §3.5): `application/x-www-form-urlencoded` with a single
// `signed_request=<base64url(sig)>.<base64url(payload)>` field, no signature
// header. Verification, the audit row and the enqueue all live in `../shared`;
// this file is only the response shape, which Meta's own dashboard tester
// validates literally.

import { WEBAPP_URL } from '@auxx/config/server'
import { buildDataDeletionStatusUrl } from '@auxx/lib/data-deletion/client'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { handleMetaSignedRequest } from '../shared'

const logger = createScopedLogger('meta-data-deletion')

/**
 * Someone asked Facebook to delete the data our app holds on them.
 *
 * Answers 200 with exactly `{ url, confirmation_code }` — the shape Meta's
 * dashboard validator checks, over HTTPS (plain HTTP fails validation). The
 * teardown itself is asynchronous: revoke the OAuth tokens and soft-delete the
 * channels the person's Facebook login connected, while the organization's
 * Messenger/Instagram conversation history is deliberately left intact. See
 * `handleMetaSignedRequest`'s docstring for why.
 *
 * Never throws. Once the signature verifies, a transient failure still answers
 * 200 — a 5xx makes Meta retry, and a retry storm on a compliance endpoint is a
 * bad look.
 *
 * The ONE exception is a failed row write. Meta's contract is that a 200 carries
 * `{url, confirmation_code}`; answering 200 with `{}` is both non-conformant and
 * a silently dropped obligation, recoverable only from a log line. There is no
 * upside to acking a request we did not record, so that case returns 503 and
 * lets Meta redeliver — the same call `api/shopify/compliance` makes on its own
 * failed write.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const outcome = await handleMetaSignedRequest(req, 'data_deletion')

    if (!outcome.verified) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    if (!outcome.confirmationCode) {
      // Verified but UNRECORDED — the durable write failed. Do not ack: a 200
      // here would claim an obligation we have no row for, and would carry none
      // of the fields Meta's validator requires. 503 makes Meta redeliver.
      return NextResponse.json({ error: 'Could not record the request' }, { status: 503 })
    }

    return NextResponse.json(
      {
        url: buildDataDeletionStatusUrl(WEBAPP_URL, outcome.confirmationCode),
        confirmation_code: outcome.confirmationCode,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('Unhandled error in the Meta data-deletion callback', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({}, { status: 200 })
  }
}

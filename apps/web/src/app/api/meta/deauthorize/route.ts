// apps/web/src/app/api/meta/deauthorize/route.ts
//
// Meta's **Deauthorize Callback URL** (App Dashboard → Facebook Login →
// Settings). Fires when someone removes the app from their personal Facebook
// *Settings → Apps and Websites*.
//
// Same `signed_request` contract as the data-deletion callback, same verifier,
// different meaning: deauthorize is *"I stopped using your app"* — the channels
// are paused (`Integration.enabled = false`) and their credentials and sync
// cursors are KEPT, so a reconnect picks up where it left off. Deletion is
// *"erase what you hold on me"* and tears the channels down. Collapsing the two
// would cost the person a reconnect-without-re-consent for no compliance gain.

import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { handleMetaSignedRequest } from '../shared'

const logger = createScopedLogger('meta-deauthorize')

/**
 * Someone removed the app from their Facebook account.
 *
 * Answers 200 with an empty body — Meta reads no status URL here. The
 * `DataDeletionRequest` row is still written so the audit trail is uniform
 * across both callbacks and both providers.
 *
 * Never throws, for the same reason as the data-deletion route.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const outcome = await handleMetaSignedRequest(req, 'deauthorize')

    if (!outcome.verified) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    // Verified but UNRECORDED — the durable write failed. Same call as the
    // data-deletion route: do not ack an obligation we have no row for; let
    // Meta redeliver instead.
    if (!outcome.requestId) {
      return NextResponse.json({ error: 'Could not record the request' }, { status: 503 })
    }

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('Unhandled error in the Meta deauthorize callback', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new NextResponse(null, { status: 200 })
  }
}

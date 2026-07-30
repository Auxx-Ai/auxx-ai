// ~/app/api/pusher/auth/batch/route.ts

import { getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { ensureWebAppInitialized } from '~/server/bootstrap'

const logger = createScopedLogger('pusher-auth-batch')

/**
 * Batched Pusher private/presence channel auth (plan v3/05).
 *
 * The sibling `../route.ts` signs ONE channel per request because that is what
 * pusher-js's AJAX transport sends. The admin client instead runs a coalescing
 * `channelAuthorization.customHandler`, which posts the whole subscribe burst
 * here as JSON — so a page load that binds ~40 channels resolves the session
 * once instead of forty times.
 *
 * Authorization is unchanged: `authorizeMany` delegates to the same
 * `RealtimeService.authorize` and therefore the same room-registry ACL.
 *
 * **A denied channel is `null` in `results`, not an HTTP error.** Per-channel
 * verdicts cannot ride the response status when the request carries many
 * channels, so the status describes only whether the REQUEST was well-formed.
 */

/**
 * Above the client's own `maxBatch` of 50, so a legitimate flush can never trip
 * this while a hand-rolled request can't ask for unbounded ACL work.
 */
const MAX_CHANNELS = 64

interface BatchAuthRequestBody {
  socket_id?: unknown
  channels?: unknown
}

export async function POST(req: NextRequest) {
  await ensureWebAppInitialized()
  try {
    let body: BatchAuthRequestBody
    try {
      body = (await req.json()) as BatchAuthRequestBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const socketId = typeof body?.socket_id === 'string' ? body.socket_id : null
    const channels = Array.isArray(body?.channels)
      ? body.channels.filter((c): c is string => typeof c === 'string')
      : null

    if (!socketId || !channels || channels.length === 0) {
      logger.warn('Missing required parameters', {
        socketId: !!socketId,
        channels: channels?.length ?? null,
      })
      return NextResponse.json({ error: 'Missing socket_id or channels' }, { status: 400 })
    }
    if (channels.length > MAX_CHANNELS) {
      logger.warn('Batch too large', { requested: channels.length, max: MAX_CHANNELS })
      return NextResponse.json({ error: `At most ${MAX_CHANNELS} channels` }, { status: 400 })
    }

    const unique = [...new Set(channels)]

    const session = await auth.api.getSession({ headers: await headers() })
    const realtimeService = getRealtimeService()

    // Identical construction to the single-channel route. A caller with no
    // session gets `session: null`, which every registry ACL reads as a denial
    // — so the answer is a full sheet of `null`, NOT a 401. The per-channel
    // route never made that distinction and introducing it here would report
    // "you are anonymous" separately from "you may not have this channel".
    const ctx = {
      session: session?.user?.defaultOrganizationId
        ? { userId: session.user.id, organizationId: session.user.defaultOrganizationId }
        : null,
    }

    const userData = session?.user
      ? {
          id: session.user.id,
          name: session.user.name || undefined,
          email: session.user.email || undefined,
          image: session.user.image || undefined,
        }
      : undefined

    const results = await realtimeService.authorizeMany(socketId, unique, ctx, userData)

    // ONE line per burst. The per-channel route logs a warn per denial, which
    // is what put ~25 lines in the terminal on every refresh.
    const denied = unique.filter((c) => !results[c])
    logger.debug('Pusher batch auth', {
      userId: session?.user?.id,
      requested: unique.length,
      authorized: unique.length - denied.length,
      denied,
    })

    return NextResponse.json({ results })
  } catch (error) {
    logger.error('Unexpected error in Pusher batch auth', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

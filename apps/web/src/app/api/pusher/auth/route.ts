// ~/app/api/pusher/auth/route.ts

import { getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { ensureWebAppInitialized } from '~/server/bootstrap'

const logger = createScopedLogger('pusher-auth')

/**
 * Pusher private/presence channel auth endpoint.
 *
 * Pulls `socket_id` + `channel_name` from the form body, resolves the room key
 * from the registry, and signs the auth response if the ACL passes.
 *
 * The widget posts to `/api/chat/pusher/auth` (apps/api) — visitor-scoped rooms
 * routed through this endpoint require a session, which the widget never has.
 * Vestigial `private-chat-*` bindings here are handled by the registry's
 * chat-session entry (anonymous-allowed, matching the legacy behavior).
 */
export async function POST(req: NextRequest) {
  await ensureWebAppInitialized()
  try {
    const formData = await req.formData()
    const socket_id = formData.get('socket_id') as string | null
    const channel_name = formData.get('channel_name') as string | null

    if (!socket_id || !channel_name) {
      logger.warn('Missing required parameters', { socket_id, channel_name })
      return NextResponse.json({ error: 'Missing socket_id or channel_name' }, { status: 400 })
    }

    const session = await auth.api.getSession({ headers: await headers() })
    const realtimeService = getRealtimeService()

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

    const authResponse = await realtimeService.authorize(socket_id, channel_name, ctx, userData)

    if (!authResponse) {
      logger.warn('Pusher auth denied', {
        userId: session?.user?.id,
        channel_name,
      })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(authResponse)
  } catch (error) {
    logger.error('Unexpected error in Pusher auth', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

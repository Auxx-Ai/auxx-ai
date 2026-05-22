// ~/app/api/pusher/auth/route.ts

import { database } from '@auxx/database'
import { InboxService } from '@auxx/lib/inboxes'
import { findMemberByUser } from '@auxx/lib/members'
import { getRealtimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { ensureWebAppInitialized } from '~/server/bootstrap'

const logger = createScopedLogger('pusher-auth')

export async function POST(req: NextRequest) {
  await ensureWebAppInitialized()
  logger.info('Received Pusher auth request')
  try {
    const formData = await req.formData()
    const socket_id = formData.get('socket_id') as string | null
    const channel_name = formData.get('channel_name') as string | null

    // const { socket_id, channel_name } = body

    logger.info('Pusher auth request', {
      socket_id: socket_id?.substring(0, 10) + '...', // Log partial ID for privacy
      channel_name,
    })

    if (!socket_id || !channel_name) {
      logger.warn('Missing required parameters', { socket_id, channel_name })
      return NextResponse.json({ error: 'Missing socket_id or channel_name' }, { status: 400 })
    }
    const realTimeService = getRealtimeService()

    // Handle chat channels (no authentication required)
    if (channel_name.startsWith('private-chat-')) {
      logger.info('Authenticating chat channel', { channel_name })

      // Authenticate the channel without user data. The visitor passport
      // already authorizes the channel; Pusher-side channel binding enforces
      // it on publish.
      const authResponse = realTimeService.authenticateChannel(socket_id, channel_name)

      if (!authResponse) {
        logger.error('Failed to authenticate chat channel', { channel_name })
        return NextResponse.json(
          { error: 'Authentication failed for chat channel' },
          { status: 500 }
        )
      }

      logger.info('Chat channel authenticated successfully', {
        channel_name,
        auth: authResponse.auth?.substring(0, 10) + '...',
      })
      return NextResponse.json(authResponse)
    }

    // For all other channels, require user authentication
    // const session = await auth()
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session || !session.user) {
      logger.warn('Unauthorized access attempt', { channel_name })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Optional: Verify organization membership for presence-org channels.
    // Per-inbox channels (`presence-org-{org}-inbox-{inboxId|none}`) require
    // an additional access check below.
    if (channel_name.startsWith('presence-org-')) {
      // Match `presence-org-{orgId}` and optionally `-inbox-{slug}`
      const orgChannelMatch = channel_name.match(
        /^presence-org-([^-]+(?:-[^-]+)*?)(?:-inbox-([^-]+))?$/
      )
      // Fallback: split on `-inbox-` boundary which is unambiguous.
      const inboxSplit = channel_name.split('-inbox-')
      const orgId = inboxSplit[0].replace('presence-org-', '')
      const inboxSlug = inboxSplit[1] ?? null
      void orgChannelMatch

      try {
        const membership = await findMemberByUser(orgId, session.user.id)

        if (!membership && process.env.NODE_ENV !== 'development') {
          logger.warn('User not part of organization', { userId: session.user.id, orgId })
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Per-inbox channel: verify inbox access.
        // - `none` (triage / unassigned) is allowed for any org member.
        // - Otherwise check the user's view permission on that inbox.
        if (inboxSlug && inboxSlug !== 'none') {
          const inboxService = new InboxService(database, orgId, session.user.id)
          const allowed = await inboxService.hasUserAccess(
            toRecordId('inbox', inboxSlug),
            session.user.id
          )
          if (!allowed && process.env.NODE_ENV !== 'development') {
            logger.warn('User has no access to requested inbox channel', {
              userId: session.user.id,
              orgId,
              inboxId: inboxSlug,
            })
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }
      } catch (error) {
        logger.error('Error verifying organization / inbox membership', {
          userId: session.user.id,
          orgId,
          inboxSlug,
          error,
        })
        // We'll continue with auth in development mode
        if (process.env.NODE_ENV !== 'development') {
          return NextResponse.json(
            { error: 'Error verifying organization membership' },
            { status: 500 }
          )
        }
      }
    }

    // Authenticate with user data for all other private/presence channels
    const authResponse = realTimeService.authenticateChannel(socket_id, channel_name, {
      id: session.user.id,
      name: session.user.name || undefined,
      email: session.user.email || undefined,
      image: session.user.image || undefined,
    })

    if (!authResponse) {
      logger.error('Failed to authenticate user channel', { userId: session.user.id, channel_name })
      return NextResponse.json({ error: 'Authentication failed for user channel' }, { status: 500 })
    }

    logger.info('User channel authenticated successfully', {
      userId: session.user.id,
      channel_name,
    })
    return NextResponse.json(authResponse)
  } catch (error) {
    logger.error('Unexpected error in Pusher auth', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

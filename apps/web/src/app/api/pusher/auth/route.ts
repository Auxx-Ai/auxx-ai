// ~/app/api/pusher/auth/route.ts

import { database, schema } from '@auxx/database'
import { findMemberByUser } from '@auxx/lib/members'
import { RealTimeService } from '@auxx/lib/realtime'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('pusher-auth')

export async function POST(req: NextRequest) {
  logger.info('Received Pusher auth request')
  // try {
  // const body = await req.json()
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
  const realTimeService = new RealTimeService()

  // Check if Pusher is properly initialized
  if (!realTimeService.isPusherInitialized()) {
    logger.error('Pusher not initialized in RealTimeService')
    return NextResponse.json(
      { error: 'Real-time service not properly configured' },
      { status: 500 }
    )
  }

  // Handle chat channels (no authentication required)
  if (channel_name.startsWith('private-chat-')) {
    logger.info('Authenticating chat session channel', { channel_name })

    // Extract sessionId from channel name
    const sessionId = channel_name.replace('private-chat-', '')

    // Skip database verification during development or if specified in config
    const skipVerification =
      process.env.NODE_ENV === 'development' &&
      process.env.SKIP_CHAT_SESSION_VERIFICATION === 'true'

    if (!skipVerification) {
      try {
        // Check if the session exists
        const [chatSession] = await database
          .select()
          .from(schema.ChatSession)
          .where(eq(schema.ChatSession.id, sessionId))
          .limit(1)
        const session = chatSession ?? null

        if (!session) {
          logger.warn('Chat session not found', { sessionId, channel_name })
          return NextResponse.json({ error: 'Invalid chat session' }, { status: 403 })
        }
      } catch (error) {
        logger.error('Error verifying chat session', { sessionId, error })
        // During development, we can continue even if verification fails
        if (process.env.NODE_ENV !== 'development') {
          return NextResponse.json({ error: 'Error verifying chat session' }, { status: 500 })
        }
        logger.warn('Proceeding despite session verification error (development mode)')
      }
    }

    // Authenticate the channel without user data
    const authResponse = realTimeService.authenticateChannel(socket_id, channel_name)

    if (!authResponse) {
      logger.error('Failed to authenticate chat channel', { channel_name })
      return NextResponse.json({ error: 'Authentication failed for chat channel' }, { status: 500 })
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

  // Optional: Verify organization membership for presence-org channels
  if (channel_name.startsWith('presence-org-')) {
    const orgId = channel_name.replace('presence-org-', '')

    try {
      const membership = await findMemberByUser(orgId, session.user.id)

      if (!membership && process.env.NODE_ENV !== 'development') {
        logger.warn('User not part of organization', { userId: session.user.id, orgId })
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } catch (error) {
      logger.error('Error verifying organization membership', {
        userId: session.user.id,
        orgId,
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

  logger.info('User channel authenticated successfully', { userId: session.user.id, channel_name })
  return NextResponse.json(authResponse)
  // } catch (error) {
  //   logger.error('Unexpected error in Pusher auth', { error })
  //   return NextResponse.json(
  //     { error: 'Internal server error' },
  //     { status: 500 }
  //   )
  // }
}

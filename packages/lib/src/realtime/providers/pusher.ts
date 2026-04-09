// @auxx/lib/realtime/providers/pusher.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import Pusher from 'pusher'
import type { RealtimeProvider } from '../types'

const logger = createScopedLogger('pusher-realtime-provider')

/**
 * Server-side Pusher implementation of RealtimeProvider.
 * Lazily initializes the Pusher SDK from credentials config.
 */
export class PusherRealtimeProvider implements RealtimeProvider {
  private pusher: Pusher | null = null

  constructor() {
    this.initialize()
  }

  private initialize() {
    try {
      const appId = configService.get<string>('PUSHER_APP_ID')
      const key = configService.get<string>('PUSHER_KEY')
      const secret = configService.get<string>('PUSHER_SECRET')
      const cluster = configService.get<string>('PUSHER_CLUSTER')

      if (appId && key && secret && cluster) {
        this.pusher = new Pusher({ appId, key, secret, cluster, useTLS: true })
        logger.info('Pusher initialized successfully')
      } else {
        logger.warn('Pusher credentials not found, realtime disabled', {
          appId: !!appId,
          key: !!key,
          secret: !!secret,
          cluster: !!cluster,
        })
      }
    } catch (error) {
      logger.error('Failed to initialize Pusher', { error })
    }
  }

  async publish(
    channel: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, skipping publish')
        return false
      }

      const params: Record<string, string> = {}
      if (options?.excludeSocketId) {
        params.socket_id = options.excludeSocketId
      }

      await this.pusher.trigger(channel, event, data, params)
      return true
    } catch (error) {
      logger.error('Failed to publish event', { error, channel, event })
      return false
    }
  }

  authenticate(
    socketId: string,
    channel: string,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ): { auth: string; channel_data?: string } | null {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, cannot authenticate channel')
        return null
      }

      if (channel.startsWith('private-')) {
        const authResponse = this.pusher.authorizeChannel(socketId, channel)
        logger.debug('Private channel authorization', {
          channel,
          socketId: socketId.substring(0, 10) + '...',
          success: !!authResponse,
        })
        return authResponse
      }

      if (channel.startsWith('presence-') && userData) {
        const authResponse = this.pusher.authorizeChannel(socketId, channel, {
          user_id: userData.id,
          user_info: {
            name: userData.name || 'Unknown User',
            email: userData.email,
            image: userData.image,
          },
        })
        logger.debug('Presence channel authorization', {
          channel,
          socketId: socketId.substring(0, 10) + '...',
          userId: userData.id,
          success: !!authResponse,
        })
        return authResponse
      }

      logger.warn('Invalid channel type or missing user data', { channel })
      return null
    } catch (error) {
      logger.error('Failed to authenticate channel', {
        error,
        socketId: socketId.substring(0, 10) + '...',
        channel,
      })
      return null
    }
  }
}

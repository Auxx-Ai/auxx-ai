// @auxx/lib/realtime/realtime-service.ts
import { createScopedLogger } from '@auxx/logger'
import Pusher from 'pusher'
import { env } from '@auxx/config/server'

const logger = createScopedLogger('realtime-service')

/**
 * RealTimeService for sending real-time notifications
 * This is a simple implementation using Pusher, but could be
 * replaced with Socket.io, Ably, or any other real-time service
 */
export class RealTimeService {
  private pusher: Pusher | null = null

  constructor() {
    this.initializePusher()
  }

  /**
   * Check if Pusher is properly initialized
   */
  public isPusherInitialized(): boolean {
    return this.pusher !== null
  }

  /**
   * Initialize the Pusher client
   */
  private initializePusher() {
    try {
      // Check if Pusher credentials are available
      if (env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER) {
        this.pusher = new Pusher({
          appId: env.PUSHER_APP_ID,
          key: env.PUSHER_KEY,
          secret: env.PUSHER_SECRET,
          cluster: env.PUSHER_CLUSTER,
          useTLS: true,
        })
        logger.info('Pusher initialized successfully')
      } else {
        logger.warn('Pusher credentials not found, real-time service disabled', {
          appId: !!env.PUSHER_APP_ID,
          key: !!env.PUSHER_KEY,
          secret: !!env.PUSHER_SECRET,
          cluster: !!env.PUSHER_CLUSTER,
        })
        this.pusher = null
      }
    } catch (error) {
      logger.error('Failed to initialize Pusher', { error })
      this.pusher = null
    }
  }

  /**
   * Send an event to a specific user's channel
   */
  async sendToUser(userId: string, event: string, data: any): Promise<boolean> {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, skipping real-time notification')
        return false
      }

      // Use a private channel for user-specific events
      const channelName = `private-user-${userId}`

      await this.pusher.trigger(channelName, event, data)
      return true
    } catch (error) {
      logger.error('Failed to send real-time notification', { error, userId, event })
      return false
    }
  }

  /**
   * Send an event to a chat channel
   */
  async sendToChat(sessionId: string, event: string, data: any): Promise<boolean> {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, skipping chat notification')
        return false
      }

      // Use a private channel for chat sessions
      const channelName = `private-chat-${sessionId}`

      await this.pusher.trigger(channelName, event, data)
      return true
    } catch (error) {
      logger.error('Failed to send real-time notification to chat', { error, sessionId, event })
      return false
    }
  }

  /**
   * Send an event to an organization channel
   */
  async sendToOrganization(organizationId: string, event: string, data: any): Promise<boolean> {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, skipping real-time notification')
        return false
      }

      // Use a presence channel for organization-wide events
      const channelName = `presence-org-${organizationId}`

      await this.pusher.trigger(channelName, event, data)
      return true
    } catch (error) {
      logger.error('Failed to send real-time notification to organization', {
        error,
        organizationId,
        event,
      })
      return false
    }
  }

  /**
   * Create an authentication signature for private/presence channels
   * This would be used in your API endpoint for Pusher channel authentication
   */
  authenticateChannel(
    socketId: string,
    channel: string,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ): { auth: string; channel_data?: string } | null {
    try {
      if (!this.pusher) {
        logger.warn('Pusher not initialized, cannot authenticate channel')
        return null
      }

      // For private channels
      if (channel.startsWith('private-')) {
        const authResponse = this.pusher.authorizeChannel(socketId, channel)
        logger.debug('Private channel authorization result', {
          channel,
          socketId: socketId.substring(0, 10) + '...',
          success: !!authResponse,
        })
        return authResponse
      }

      // For presence channels
      if (channel.startsWith('presence-') && userData) {
        const authResponse = this.pusher.authorizeChannel(socketId, channel, {
          user_id: userData.id,
          user_info: {
            name: userData.name || 'Unknown User',
            email: userData.email,
            image: userData.image,
          },
        })
        logger.debug('Presence channel authorization result', {
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

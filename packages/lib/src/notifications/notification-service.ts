// lib/notifications/notification-service.ts
import { database as db, schema } from '@auxx/database'
import type { NotificationType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import { RealTimeService } from '../realtime/realtime-service'

const logger = createScopedLogger('notification-service')
// Input interface for creating a notification
interface CreateNotificationInput {
  type: NotificationType
  userId: string // Recipient user ID
  entityId: string // ID of related entity
  entityType: string // Type of related entity
  message: string // Display message
  actorId?: string // User who triggered the notification (optional)
  organizationId?: string // Optional if can be derived from entity
  data?: Record<string, any> // Additional data for the notification
}
// Options for retrieving notifications
interface GetNotificationsOptions {
  page?: number
  limit?: number
  includeRead?: boolean
  types?: NotificationType[]
  since?: Date
}
export class NotificationService {
  private realTimeService: RealTimeService | null = null
  // Accept an optional db; defaults to shared database instance
  constructor(private database = db) {
    // Initialize real-time service if available
    try {
      this.realTimeService = new RealTimeService()
    } catch (error) {
      logger.warn(
        'Real-time service not available, notifications will not be delivered in real-time'
      )
      this.realTimeService = null
    }
  }
  /**
   * Create and send a notification
   */
  async sendNotification(data: CreateNotificationInput): Promise<any> {
    try {
      logger.debug('sendNotification called', {
        type: data.type,
        userId: data.userId,
        entityId: data.entityId,
        entityType: data.entityType,
        organizationId: data.organizationId,
      })
      const {
        type,
        userId,
        entityId,
        entityType,
        message,
        actorId,
        organizationId,
        data: additionalData,
      } = data
      // If organizationId not provided, try to derive it from the entity
      let derivedOrgId = organizationId

      if (!derivedOrgId) {
        logger.debug('Deriving organization ID', { entityType, entityId })
        derivedOrgId = await this.deriveOrganizationId(entityType, entityId)
      }
      if (!derivedOrgId) {
        const error = `Failed to determine organization ID for ${entityType} ${entityId}`
        logger.error(error)
        throw new Error(error)
      }
      logger.debug('Creating notification in database', {
        type,
        userId,
        entityId,
        entityType,
        derivedOrgId,
      })
      // Create notification in database
      const [notification] = await this.database
        .insert(schema.Notification)
        .values({
          type: type as any,
          userId,
          actorId,
          entityId,
          entityType,
          message,
          organizationId: derivedOrgId!,
          ...(additionalData ? { metadata: additionalData as any } : {}),
        })
        .returning()
      logger.info('Notification created successfully', {
        notificationId: notification!.id,
        userId,
        type,
      })
      // Send real-time notification if service is available
      if (this.realTimeService) {
        logger.debug('Sending real-time notification', { userId, notificationId: notification!.id })
        await this.realTimeService.sendToUser(userId, 'notification', notification)
      } else {
        logger.warn('Real-time service not available, skipping real-time notification')
      }
      // Future enhancement: Add email/push notification delivery here
      // based on user preferences
      return notification
    } catch (error) {
      logger.error('Failed to send notification', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        data,
      })
      throw error
    }
  }
  /**
   * Get notifications for a user
   */
  async getNotifications(userId: string, options: GetNotificationsOptions = {}) {
    try {
      const { page = 1, limit = 20, includeRead = false, types, since } = options
      // Calculate pagination
      const skip = (page - 1) * limit
      // Build the where clause
      // Build conditions
      const conditions = [eq(schema.Notification.userId, userId)] as any[]
      if (!includeRead) conditions.push(eq(schema.Notification.isRead, false as any))
      if (types?.length) conditions.push(inArray(schema.Notification.type, types as any))
      if (since) conditions.push(gte(schema.Notification.createdAt, since))
      // Get total count
      const [{ cnt }] = await this.database
        .select({ cnt: count() })
        .from(schema.Notification)
        .where(and(...conditions))

      // Get notifications with actor join
      const rows = await this.database
        .select({
          n: schema.Notification,
          actor: { id: schema.User.id, name: schema.User.name, image: schema.User.image },
        })
        .from(schema.Notification)
        .leftJoin(schema.User, eq(schema.Notification.actorId, schema.User.id))
        .where(and(...conditions))
        .orderBy(desc(schema.Notification.createdAt))
        .offset(skip)
        .limit(limit)

      const notifications = rows.map((r) => ({ ...r.n, actor: r.actor }))
      return { notifications, totalCount: Number((cnt as any) ?? 0) }
    } catch (error) {
      logger.error('Failed to retrieve notifications', { error, userId, options })
      throw error
    }
  }
  /**
   * Mark notifications as read
   */
  async markAsRead(userId: string, notificationIds: string[]): Promise<number> {
    try {
      const toUpdate = await this.database
        .select({ id: schema.Notification.id })
        .from(schema.Notification)
        .where(
          and(
            inArray(schema.Notification.id, notificationIds),
            eq(schema.Notification.userId, userId)
          )
        )
      if (!toUpdate.length) return 0
      await this.database
        .update(schema.Notification)
        .set({ isRead: true as any, readAt: new Date() })
        .where(
          inArray(
            schema.Notification.id,
            toUpdate.map((r) => r.id)
          )
        )
      return toUpdate.length
    } catch (error) {
      logger.error('Failed to mark notifications as read', { error, userId, notificationIds })
      throw error
    }
  }
  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    try {
      const toUpdate = await this.database
        .select({ id: schema.Notification.id })
        .from(schema.Notification)
        .where(
          and(eq(schema.Notification.userId, userId), eq(schema.Notification.isRead, false as any))
        )
      if (!toUpdate.length) return 0
      await this.database
        .update(schema.Notification)
        .set({ isRead: true as any, readAt: new Date() })
        .where(
          inArray(
            schema.Notification.id,
            toUpdate.map((r) => r.id)
          )
        )
      return toUpdate.length
    } catch (error) {
      logger.error('Failed to mark all notifications as read', { error, userId })
      throw error
    }
  }
  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string, organizationId?: string): Promise<number> {
    try {
      const conditions = [
        eq(schema.Notification.userId, userId),
        eq(schema.Notification.isRead, false as any),
      ] as any[]
      if (organizationId) conditions.push(eq(schema.Notification.organizationId, organizationId))
      const [{ cnt }] = await this.database
        .select({ cnt: count() })
        .from(schema.Notification)
        .where(and(...conditions))
      return Number((cnt as any) ?? 0)
    } catch (error) {
      logger.error('Failed to get unread notification count', { error, userId })
      throw error
    }
  }
  /**
   * Delete notifications
   */
  async deleteNotifications(userId: string, notificationIds: string[]): Promise<number> {
    try {
      const toDelete = await this.database
        .select({ id: schema.Notification.id })
        .from(schema.Notification)
        .where(
          and(
            inArray(schema.Notification.id, notificationIds),
            eq(schema.Notification.userId, userId)
          )
        )
      if (!toDelete.length) return 0
      await this.database.delete(schema.Notification).where(
        inArray(
          schema.Notification.id,
          toDelete.map((r) => r.id)
        )
      )
      return toDelete.length
    } catch (error) {
      logger.error('Failed to delete notifications', { error, userId, notificationIds })
      throw error
    }
  }
  /**
   * Delete notifications by entity type and ID
   * Used for cleanup when entities are removed (e.g., approval requests cancelled)
   */
  async deleteNotificationsByEntity(
    entityType: string,
    entityId: string,
    organizationId?: string
  ): Promise<number> {
    try {
      const conditions = [
        eq(schema.Notification.entityType, entityType),
        eq(schema.Notification.entityId, entityId),
      ] as any[]
      if (organizationId) conditions.push(eq(schema.Notification.organizationId, organizationId))
      const toDelete = await this.database
        .select({ id: schema.Notification.id })
        .from(schema.Notification)
        .where(and(...conditions))
      if (!toDelete.length) return 0
      await this.database.delete(schema.Notification).where(
        inArray(
          schema.Notification.id,
          toDelete.map((r) => r.id)
        )
      )
      logger.info('Deleted notifications by entity', {
        entityType,
        entityId,
        organizationId,
        deletedCount: toDelete.length,
      })
      return toDelete.length
    } catch (error) {
      logger.error('Error deleting notifications by entity', {
        error,
        entityType,
        entityId,
        organizationId,
      })
      throw error
    }
  }
  /**
   * Delete old read notifications to keep the database clean
   * This can be run as a scheduled job
   */
  async cleanupOldNotifications(
    olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Default 30 days
  ): Promise<number> {
    try {
      const toDelete = await this.database
        .select({ id: schema.Notification.id })
        .from(schema.Notification)
        .where(
          and(
            eq(schema.Notification.isRead, true as any),
            lt(schema.Notification.readAt, olderThan)
          )
        )
      if (!toDelete.length) return 0
      await this.database.delete(schema.Notification).where(
        inArray(
          schema.Notification.id,
          toDelete.map((r) => r.id)
        )
      )
      logger.info(`Cleaned up ${toDelete.length} old notifications`)
      return toDelete.length
    } catch (error) {
      logger.error('Failed to clean up old notifications', { error, olderThan })
      throw error
    }
  }
  /**
   * Helper method to derive organization ID from an entity
   */
  private async deriveOrganizationId(entityType: string, entityId: string): Promise<string | null> {
    try {
      switch (entityType) {
        case 'Comment': {
          const [comment] = await this.database
            .select({ organizationId: schema.Comment.organizationId })
            .from(schema.Comment)
            .where(eq(schema.Comment.id, entityId))
            .limit(1)
          return comment?.organizationId || null
        }
        case 'Ticket': {
          const [ticket] = await this.database
            .select({ organizationId: schema.Ticket.organizationId })
            .from(schema.Ticket)
            .where(eq(schema.Ticket.id, entityId))
            .limit(1)
          return ticket?.organizationId || null
        }
        case 'Thread': {
          const [thread] = await this.database
            .select({ integrationId: schema.Thread.integrationId })
            .from(schema.Thread)
            .where(eq(schema.Thread.id, entityId))
            .limit(1)
          if (!thread) return null
          // Get organization from integration
          const [integration] = await this.database
            .select({ organizationId: schema.Integration.organizationId })
            .from(schema.Integration)
            .where(eq(schema.Integration.id, thread.integrationId))
            .limit(1)
          return integration?.organizationId || null
        }
        // Add more entity types as needed
        default:
          logger.warn(`No derivation rule for entity type: ${entityType}`)
          return null
      }
    } catch (error) {
      logger.error('Error deriving organization ID', { error, entityType, entityId })
      return null
    }
  }
}

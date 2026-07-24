// packages/lib/src/notifications/notification-service.ts

import { database as db, schema } from '@auxx/database'
import type { NotificationType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm'
import { getRealtimeService, rooms } from '../realtime'
import type { RealtimeService } from '../realtime/realtime-service'
import type {
  NotificationMetadata,
  NotificationTargetIdsMap,
  NotificationTargetType,
} from './client'

const logger = createScopedLogger('notification-service')

export interface CreateNotificationInput<
  T extends NotificationTargetType = NotificationTargetType,
> {
  type: NotificationType
  userId: string
  organizationId: string
  targetType: T
  targetIds: NotificationTargetIdsMap[T]
  message: string
  actorId?: string
  metadata?: NotificationMetadata
}

export interface GetNotificationsOptions {
  cursor?: { createdAt: Date; id: string } | null
  limit?: number
  includeRead?: boolean
  types?: NotificationType[]
  search?: string
}

interface RealtimeOptions {
  excludeSocketId?: string
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** Creates, queries, and reconciles user notifications. */
export class NotificationService {
  private realTimeService: RealtimeService

  constructor(private database = db) {
    this.realTimeService = getRealtimeService()
  }

  /** Create a notification and publish it to the recipient's realtime room. */
  async sendNotification<T extends NotificationTargetType>(
    data: CreateNotificationInput<T>
  ): Promise<typeof schema.Notification.$inferSelect> {
    try {
      const [notification] = await this.database
        .insert(schema.Notification)
        .values({
          type: data.type,
          userId: data.userId,
          actorId: data.actorId,
          targetType: data.targetType,
          targetIds: data.targetIds,
          message: data.message,
          organizationId: data.organizationId,
          metadata: data.metadata,
        })
        .returning()

      if (!notification) throw new Error('Failed to create notification')

      await this.publishUserEvent(data.userId, 'notification', notification)
      return notification
    } catch (error) {
      logger.error('Failed to send notification', {
        error: error instanceof Error ? error.message : String(error),
        data,
      })
      throw error
    }
  }

  /** Get one keyset-paginated, organization-scoped page of notifications. */
  async getNotifications(
    userId: string,
    organizationId: string,
    options: GetNotificationsOptions = {}
  ) {
    const { cursor, limit = 25, includeRead = true, types, search } = options
    const conditions: SQL[] = [
      eq(schema.Notification.userId, userId),
      eq(schema.Notification.organizationId, organizationId),
    ]

    if (!includeRead) conditions.push(eq(schema.Notification.isRead, false))
    if (types?.length) conditions.push(inArray(schema.Notification.type, types))
    if (search?.trim()) {
      conditions.push(ilike(schema.Notification.message, `%${escapeLikePattern(search.trim())}%`))
    }
    if (cursor) {
      conditions.push(
        or(
          lt(schema.Notification.createdAt, cursor.createdAt),
          and(
            eq(schema.Notification.createdAt, cursor.createdAt),
            lt(schema.Notification.id, cursor.id)
          )
        )!
      )
    }

    const rows = await this.database
      .select({
        notification: schema.Notification,
        actor: { id: schema.User.id, name: schema.User.name, image: schema.User.image },
      })
      .from(schema.Notification)
      .leftJoin(schema.User, eq(schema.Notification.actorId, schema.User.id))
      .where(and(...conditions))
      .orderBy(desc(schema.Notification.createdAt), desc(schema.Notification.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const notifications = page.map(({ notification, actor }) => ({
      ...notification,
      actor: actor?.id ? actor : null,
    }))
    const last = notifications.at(-1)

    return {
      notifications,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    }
  }

  /** Mark selected notifications as read for a user. */
  async markAsRead(
    userId: string,
    notificationIds: string[],
    options?: RealtimeOptions
  ): Promise<number> {
    const updated = await this.database
      .update(schema.Notification)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          inArray(schema.Notification.id, notificationIds),
          eq(schema.Notification.userId, userId),
          eq(schema.Notification.isRead, false)
        )
      )
      .returning({ id: schema.Notification.id })

    if (updated.length) {
      await this.publishUserEvent(
        userId,
        'notification:read',
        { ids: updated.map(({ id }) => id) },
        options?.excludeSocketId
      )
    }
    return updated.length
  }

  /** Mark every unread notification in one organization as read. */
  async markAllAsRead(
    userId: string,
    organizationId: string,
    options?: RealtimeOptions
  ): Promise<number> {
    const updated = await this.database
      .update(schema.Notification)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(schema.Notification.userId, userId),
          eq(schema.Notification.organizationId, organizationId),
          eq(schema.Notification.isRead, false)
        )
      )
      .returning({ id: schema.Notification.id })

    if (updated.length) {
      await this.publishUserEvent(
        userId,
        'notification:read',
        { ids: updated.map(({ id }) => id) },
        options?.excludeSocketId
      )
    }
    return updated.length
  }

  /** Count unread notifications for a user in one organization. */
  async getUnreadCount(userId: string, organizationId: string): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(schema.Notification)
      .where(
        and(
          eq(schema.Notification.userId, userId),
          eq(schema.Notification.organizationId, organizationId),
          eq(schema.Notification.isRead, false)
        )
      )
    return Number(row?.value ?? 0)
  }

  /** Delete selected notifications owned by a user. */
  async deleteNotifications(
    userId: string,
    notificationIds: string[],
    options?: RealtimeOptions
  ): Promise<number> {
    const deleted = await this.database
      .delete(schema.Notification)
      .where(
        and(
          inArray(schema.Notification.id, notificationIds),
          eq(schema.Notification.userId, userId)
        )
      )
      .returning({ id: schema.Notification.id })

    if (deleted.length) {
      await this.publishUserEvent(
        userId,
        'notification:deleted',
        { ids: deleted.map(({ id }) => id) },
        options?.excludeSocketId
      )
    }
    return deleted.length
  }

  /** Delete all read notifications for a user in one organization. */
  async deleteReadNotifications(
    userId: string,
    organizationId: string,
    options?: RealtimeOptions
  ): Promise<number> {
    return this.deleteWhere(
      userId,
      and(
        eq(schema.Notification.userId, userId),
        eq(schema.Notification.organizationId, organizationId),
        eq(schema.Notification.isRead, true)
      )!,
      options
    )
  }

  /** Delete every notification for a user in one organization. */
  async deleteAllNotifications(
    userId: string,
    organizationId: string,
    options?: RealtimeOptions
  ): Promise<number> {
    return this.deleteWhere(
      userId,
      and(
        eq(schema.Notification.userId, userId),
        eq(schema.Notification.organizationId, organizationId)
      )!,
      options
    )
  }

  private async deleteWhere(
    userId: string,
    condition: SQL,
    options?: RealtimeOptions
  ): Promise<number> {
    const deleted = await this.database
      .delete(schema.Notification)
      .where(condition)
      .returning({ id: schema.Notification.id })
    if (deleted.length) {
      await this.publishUserEvent(
        userId,
        'notification:deleted',
        { all: true },
        options?.excludeSocketId
      )
    }
    return deleted.length
  }

  /** Delete notifications that point to a target, usually after target removal. */
  async deleteNotificationsByTarget<T extends NotificationTargetType>(
    targetType: T,
    targetIds: Partial<NotificationTargetIdsMap[T]>,
    organizationId?: string,
    options?: { userIds?: string[]; types?: NotificationType[] }
  ): Promise<number> {
    const conditions: SQL[] = [
      eq(schema.Notification.targetType, targetType),
      sql`${schema.Notification.targetIds} @> ${JSON.stringify(targetIds)}::jsonb`,
    ]
    if (organizationId) conditions.push(eq(schema.Notification.organizationId, organizationId))
    if (options?.userIds?.length) {
      conditions.push(inArray(schema.Notification.userId, options.userIds))
    }
    if (options?.types?.length) {
      conditions.push(inArray(schema.Notification.type, options.types))
    }

    const deleted = await this.database
      .delete(schema.Notification)
      .where(and(...conditions))
      .returning({ id: schema.Notification.id })
    return deleted.length
  }

  /** Delete read notifications older than 30 days by default. */
  async cleanupOldNotifications(
    olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  ): Promise<number> {
    const deleted = await this.database
      .delete(schema.Notification)
      .where(and(eq(schema.Notification.isRead, true), lt(schema.Notification.readAt, olderThan)))
      .returning({ id: schema.Notification.id })
    return deleted.length
  }

  private async publishUserEvent(
    userId: string,
    event: string,
    data: unknown,
    excludeSocketId?: string
  ): Promise<void> {
    if (!this.realTimeService) return
    try {
      await this.realTimeService.publish(
        rooms.user(userId),
        event,
        data,
        excludeSocketId ? { excludeSocketId } : undefined
      )
    } catch (error) {
      logger.warn('Failed to publish notification event', { event, userId, error })
    }
  }
}

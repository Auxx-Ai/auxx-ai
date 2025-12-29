// server/api/routers/notification.ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { NotificationService } from '@auxx/lib/notifications'
import { createScopedLogger } from '@auxx/logger'
const logger = createScopedLogger('notification-router')
import { NotificationType } from '@auxx/database/enums'
export const notificationRouter = createTRPCRouter({
  // Get user's notifications
  getNotifications: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        includeRead: z.boolean().default(false),
        types: z.array(z.enum(NotificationType)).optional(),
        since: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const notificationService = new NotificationService(ctx.db)
        const { userId } = ctx.session
        const { notifications, totalCount } = await notificationService.getNotifications(
          userId,
          input
        )
        return {
          notifications,
          totalCount,
          pageCount: Math.ceil(totalCount / input.limit),
          currentPage: input.page,
        }
      } catch (error) {
        logger.error('Error fetching notifications', { error, input })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch notifications',
        })
      }
    }),
  // Get unread notification count
  getUnreadCount: protectedProcedure
    // .input(z.object({ organizationId: z.string().optional() }))
    .query(async ({ ctx }) => {
      try {
        const notificationService = new NotificationService(ctx.db)
        const { userId, organizationId } = ctx.session
        const count = await notificationService.getUnreadCount(userId, organizationId)
        return { count }
      } catch (error) {
        logger.error('Error getting unread count', { error })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get unread notification count',
        })
      }
    }),
  // Mark notifications as read
  markAsRead: protectedProcedure
    .input(z.object({ notificationIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const notificationService = new NotificationService(ctx.db)
        const { userId } = ctx.session
        const updatedCount = await notificationService.markAsRead(userId, input.notificationIds)
        return { success: true, count: updatedCount }
      } catch (error) {
        logger.error('Error marking notifications as read', { error, input })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to mark notifications as read',
        })
      }
    }),
  // Mark all notifications as read
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const notificationService = new NotificationService(ctx.db)
      const { userId } = ctx.session
      const updatedCount = await notificationService.markAllAsRead(userId)
      return { success: true, count: updatedCount }
    } catch (error) {
      logger.error('Error marking all notifications as read', { error })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark all notifications as read',
      })
    }
  }),
  // Delete notifications
  deleteNotifications: protectedProcedure
    .input(z.object({ notificationIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const notificationService = new NotificationService(ctx.db)
        const { userId } = ctx.session
        const deletedCount = await notificationService.deleteNotifications(
          userId,
          input.notificationIds
        )
        return { success: true, count: deletedCount }
      } catch (error) {
        logger.error('Error deleting notifications', { error, input })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete notifications',
        })
      }
    }),
})

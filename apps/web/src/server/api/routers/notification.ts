// apps/web/src/server/api/routers/notification.ts

import { NotificationType } from '@auxx/database/enums'
import { NotificationService } from '@auxx/lib/notifications'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const listInput = z.object({
  cursor: z.object({ createdAt: z.date(), id: z.string() }).nullish(),
  limit: z.number().min(1).max(100).default(25),
  includeRead: z.boolean().default(true),
  types: z.array(z.enum(NotificationType)).optional(),
  search: z.string().trim().max(200).optional(),
})

export const notificationRouter = createTRPCRouter({
  getNotifications: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const service = new NotificationService(ctx.db)
    return service.getNotifications(ctx.session.userId, ctx.session.organizationId, input)
  }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const service = new NotificationService(ctx.db)
    const count = await service.getUnreadCount(ctx.session.userId, ctx.session.organizationId)
    return { count }
  }),

  markAsRead: protectedProcedure
    .input(z.object({ notificationIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const service = new NotificationService(ctx.db)
      const count = await service.markAsRead(ctx.session.userId, input.notificationIds, {
        excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
      })
      return { success: true, count }
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const service = new NotificationService(ctx.db)
    const count = await service.markAllAsRead(ctx.session.userId, ctx.session.organizationId, {
      excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
    })
    return { success: true, count }
  }),

  deleteNotifications: protectedProcedure
    .input(z.object({ notificationIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const service = new NotificationService(ctx.db)
      const count = await service.deleteNotifications(ctx.session.userId, input.notificationIds, {
        excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined,
      })
      return { success: true, count }
    }),

  deleteRead: protectedProcedure.mutation(async ({ ctx }) => {
    const service = new NotificationService(ctx.db)
    const count = await service.deleteReadNotifications(
      ctx.session.userId,
      ctx.session.organizationId,
      { excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined }
    )
    return { success: true, count }
  }),

  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    const service = new NotificationService(ctx.db)
    const count = await service.deleteAllNotifications(
      ctx.session.userId,
      ctx.session.organizationId,
      { excludeSocketId: ctx.headers.get('x-realtime-socket-id') ?? undefined }
    )
    return { success: true, count }
  }),
})

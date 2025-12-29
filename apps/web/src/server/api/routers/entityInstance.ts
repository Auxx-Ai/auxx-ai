// apps/web/src/server/api/routers/entityInstance.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { EntityInstanceService } from '@auxx/lib/entity-instances'

export const entityInstanceRouter = createTRPCRouter({
  /**
   * Create a new entity instance
   * Field values should be set separately via customField router
   */
  create: protectedProcedure
    .input(z.object({ entityDefinitionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.create(input.entityDefinitionId)
    }),

  /**
   * Get entity instance by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      const result = await service.getById(input.id)
      if (!result) {
        throw new Error('Entity instance not found')
      }
      return result
    }),

  /**
   * List instances for an entity definition with cursor-based pagination
   */
  list: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        includeArchived: z.boolean().optional().default(false),
        limit: z.number().min(1).max(100).optional().default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.list(input)
    }),

  /**
   * Archive entity instance (soft delete)
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.archive(input.id)
    }),

  /**
   * Restore archived entity instance
   */
  restore: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.restore(input.id)
    }),

  /**
   * Permanently delete entity instance
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.delete(input.id)
    }),

  /**
   * Bulk delete entity instances
   */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.bulkDelete(input.ids)
    }),

  /**
   * Bulk archive entity instances
   */
  bulkArchive: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityInstanceService(
        ctx.session.organizationId,
        ctx.session.user.id
      )
      return await service.bulkArchive(input.ids)
    }),
})

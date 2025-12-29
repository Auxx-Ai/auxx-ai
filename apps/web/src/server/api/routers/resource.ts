// apps/web/src/server/api/routers/resource.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import {
  ResourcePickerService,
  ResourceRegistryService,
  RESOURCE_TABLE_REGISTRY,
} from '@auxx/lib/resources'

/**
 * Validate resource ID - accepts both system TableId and custom entity ID (entity_xxx)
 */
const resourceIdSchema = z.string().refine(
  (val: string) => {
    // System table IDs
    if (RESOURCE_TABLE_REGISTRY.some((r: { id: string }) => r.id === val)) return true
    // Custom entity IDs (entity_xxx format)
    if (val.startsWith('entity_')) return true
    return false
  },
  { message: 'Invalid resource ID. Must be a valid TableId or entity_xxx format.' }
)

const getResourcesInputSchema = z.object({
  tableId: resourceIdSchema,
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().nullish(),
  search: z.string().optional(),
  filters: z.record(z.string(), z.any()).optional(),
  skipCache: z.boolean().optional(),
})

const getResourceByIdInputSchema = z.object({
  tableId: resourceIdSchema,
  id: z.string(),
})

export const resourceRouter = createTRPCRouter({
  /**
   * Get paginated resources for picker
   */
  getAll: protectedProcedure.input(getResourcesInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      return await service.getResources(input)
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resources: ${error.message}`,
      })
    }
  }),

  /**
   * Get single resource by ID
   */
  getById: protectedProcedure.input(getResourceByIdInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      const item = await service.getResourceById(input)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Resource not found: ${input.tableId}:${input.id}`,
        })
      }

      return item
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resource: ${error.message}`,
      })
    }
  }),

  /**
   * Get multiple resources by IDs (batch)
   * Used for hydrating relationship field values
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              resourceId: z.string(), // TableId or entity_<slug>
              id: z.string(),
            })
          )
          .max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)
        return await service.getResourcesByIds(input.items)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch resources by IDs: ${message}`,
        })
      }
    }),

  /**
   * Search resources (alias for getAll with semantic meaning)
   */
  search: protectedProcedure.input(getResourcesInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      return await service.getResources(input)
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Search failed: ${error.message}`,
      })
    }
  }),

  /**
   * Get all available resource types (system + custom entities)
   */
  getAllResourceTypes: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    try {
      const service = new ResourceRegistryService(organizationId, ctx.db)
      return await service.getAll()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resource types: ${message}`,
      })
    }
  }),

  /**
   * Invalidate cache (for testing/admin)
   */
  invalidateCache: protectedProcedure
    .input(
      z.object({
        tableId: resourceIdSchema,
        id: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)

        if (input.id) {
          await service.invalidateCacheById(input.tableId, input.id)
        } else {
          await service.invalidateCacheByTable(input.tableId)
        }

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to invalidate cache: ${message}`,
        })
      }
    }),
})

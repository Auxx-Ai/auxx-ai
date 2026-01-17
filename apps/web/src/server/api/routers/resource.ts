// apps/web/src/server/api/routers/resource.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { ResourceRegistryService } from '@auxx/lib/resources'

/**
 * Resource router - handles resource type definitions (not individual records)
 *
 * A "Resource" is a type definition (e.g., Contact, Ticket, or a custom entity)
 * For individual record operations, see the record router.
 */
export const resourceRouter = createTRPCRouter({
  /**
   * Get all available resource types (system + custom entities)
   * Returns resources with apiSlug for custom entities (used for mapping)
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    try {
      const service = new ResourceRegistryService(organizationId, ctx.db)
      const resources = await service.getAll()
      return resources
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resource types: ${message}`,
      })
    }
  }),

  /**
   * Get a single resource type by ID
   * Supports system resource IDs (TableId) and custom entity IDs (UUID)
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        const service = new ResourceRegistryService(organizationId, ctx.db)
        const resource = await service.getById(input.id)

        if (!resource) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Resource type not found: ${input.id}`,
          })
        }

        return resource
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch resource type: ${message}`,
        })
      }
    }),
})

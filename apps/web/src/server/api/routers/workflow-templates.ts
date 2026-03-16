// apps/web/src/server/api/routers/workflow-templates.ts

import { getAppCache } from '@auxx/lib/cache'
import { getAllTemplates, getTemplateById } from '@auxx/services/workflow-templates'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Public workflow templates router for users
 * Only returns public templates
 */
export const workflowTemplatesRouter = createTRPCRouter({
  /**
   * Get public workflow templates with filtering.
   * Uses app-wide cache for unfiltered requests; falls back to DB for search/category queries.
   */
  getPublic: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        categories: z.array(z.string()).optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const hasFilters = input.search || (input.categories && input.categories.length > 0)

      // Filtered queries hit DB directly for accurate search/category matching
      if (hasFilters) {
        const result = await getAllTemplates({
          ...input,
          status: 'public',
        })
        if (result.isErr()) {
          throw new Error(result.error.message)
        }
        return result.value
      }

      // Unfiltered listing served from cache
      const templates = await getAppCache().get('workflowTemplates')
      return templates.slice(0, input.limit)
    }),

  /**
   * Get a specific template by ID
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const result = await getTemplateById(input.id)

    if (result.isErr()) {
      throw new Error(result.error.message)
    }

    return result.value
  }),
})

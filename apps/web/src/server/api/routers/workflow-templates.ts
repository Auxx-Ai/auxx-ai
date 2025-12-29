// apps/web/src/server/api/routers/workflow-templates.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { getAllTemplates, getTemplateById } from '@auxx/services/workflow-templates'

/**
 * Public workflow templates router for users
 * Only returns public templates
 */
export const workflowTemplatesRouter = createTRPCRouter({
  /**
   * Get public workflow templates with filtering
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
      const result = await getAllTemplates({
        ...input,
        status: 'public', // IMPORTANT: Only return public templates
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      return result.value
    }),

  /**
   * Get a specific template by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const result = await getTemplateById(input.id)

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      return result.value
    }),
})

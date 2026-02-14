// apps/web/src/server/api/routers/admin-workflow-templates.ts

import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getAllTemplates,
  getTemplateById,
  updateTemplate,
} from '@auxx/services/workflow-templates'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'

/**
 * tRPC router for admin workflow template management
 */
export const adminWorkflowTemplatesRouter = createTRPCRouter({
  /**
   * Get all workflow templates
   */
  getAll: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        search: z.string().optional(),
        status: z.enum(['public', 'private', 'all']).optional(),
        categories: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await getAllTemplates(input)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return result.value
    }),

  /**
   * Get single workflow template
   */
  getById: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      const result = await getTemplateById(input.id)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return result.value
    }),

  /**
   * Create new workflow template
   */
  create: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        categories: z.array(z.string()),
        imgUrl: z.string().optional(),
        graph: z.any(),
        version: z.number().optional(),
        status: z.enum(['public', 'private']).optional(),
        triggerType: z.string().optional(),
        triggerConfig: z.record(z.string(), z.any()).optional(),
        envVars: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              value: z.any(),
              type: z.enum(['string', 'number', 'boolean', 'array', 'secret']),
            })
          )
          .optional(),
        variables: z.array(z.any()).optional(),
        popularity: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await createTemplate(input)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return result.value
    }),

  /**
   * Update workflow template
   */
  update: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        categories: z.array(z.string()).optional(),
        imgUrl: z.string().optional(),
        graph: z.any().optional(),
        version: z.number().optional(),
        status: z.enum(['public', 'private']).optional(),
        triggerType: z.string().optional(),
        triggerConfig: z.record(z.string(), z.any()).optional(),
        envVars: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              value: z.any(),
              type: z.enum(['string', 'number', 'boolean', 'array', 'secret']),
            })
          )
          .optional(),
        variables: z.array(z.any()).optional(),
        popularity: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await updateTemplate(input)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return result.value
    }),

  /**
   * Delete workflow template
   */
  delete: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await deleteTemplate(input.id)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return { success: true }
    }),

  /**
   * Duplicate a workflow template
   */
  duplicate: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await duplicateTemplate(input.id)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      return result.value
    }),
})

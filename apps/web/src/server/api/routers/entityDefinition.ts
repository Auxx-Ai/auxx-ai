// apps/web/src/server/api/routers/entityDefinition.ts

import { EntityDefinitionService } from '@auxx/lib/entity-definitions'
import {
  createEntityDefinitionSchema,
  updateEntityDefinitionSchema,
} from '@auxx/lib/entity-definitions/types'
import { getAllTemplates, getTemplateById, installTemplates } from '@auxx/lib/entity-templates'
import { checkSlugExists } from '@auxx/services/entity-definitions'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const entityDefinitionRouter = createTRPCRouter({
  /**
   * Check if an apiSlug already exists for the organization or is reserved
   */
  checkSlugExists: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        excludeId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await checkSlugExists({
        slug: input.slug,
        organizationId: ctx.session.organizationId,
        excludeId: input.excludeId,
      })
      if (result.isErr()) {
        if (result.error.code === 'RESERVED_SLUG') {
          return { exists: true, reason: 'reserved' as const }
        }
        throw new Error(result.error.message)
      }
      return { exists: result.value, reason: result.value ? ('taken' as const) : null }
    }),

  /**
   * Get all entity definitions for the organization
   */
  getAll: protectedProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().optional().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.getAll(input)
    }),

  /**
   * Get a single entity definition by ID
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
    const result = await service.getById(input.id)
    if (!result) {
      throw new Error('Entity definition not found')
    }
    return result
  }),

  /**
   * Get entity definition by apiSlug
   */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      const result = await service.getBySlug(input.slug)
      if (!result) {
        throw new Error('Entity definition not found')
      }
      return result
    }),

  /**
   * Create a new entity definition
   */
  create: protectedProcedure
    .input(createEntityDefinitionSchema)
    .mutation(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.create(input)
    }),

  /**
   * Update an entity definition
   * Only allows updating: icon, singular, plural, archivedAt
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: updateEntityDefinitionSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.update(input.id, input.data)
    }),

  /**
   * Archive an entity definition (soft delete)
   * Convenience endpoint that calls update internally
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.archive(input.id)
    }),

  /**
   * Restore an archived entity definition
   * Convenience endpoint that calls update internally
   */
  restore: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.restore(input.id)
    }),

  /**
   * Permanently delete an entity definition
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EntityDefinitionService(ctx.session.organizationId, ctx.session.user.id)
      return await service.delete(input.id)
    }),

  /**
   * List all available entity templates (lightweight, no field details)
   */
  getTemplates: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(({ input }) => getAllTemplates(input?.category)),

  /**
   * Get full template details (with fields) for preview
   */
  getTemplateById: protectedProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const template = getTemplateById(input.id)
    if (!template) {
      throw new Error('Template not found')
    }
    return template
  }),

  /**
   * Install selected templates — creates entity definitions with fields
   */
  createFromTemplates: protectedProcedure
    .input(
      z.object({
        templateIds: z.array(z.string()).min(1).max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await installTemplates(ctx.session.organizationId, input.templateIds)
    }),
})

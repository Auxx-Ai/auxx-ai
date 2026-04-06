// apps/web/src/server/api/routers/promptTemplate.ts

import { schema } from '@auxx/database'
import type { PromptTemplateItem, SystemTemplateGalleryItem } from '@auxx/lib/prompt-templates'
import { getPromptTemplateById, listPromptTemplates } from '@auxx/lib/prompt-templates'
import { TRPCError } from '@trpc/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const promptTemplateRouter = createTRPCRouter({
  /**
   * List org-specific prompt templates (user-created + installed).
   * These are the templates that appear in the inline slash picker.
   */
  list: protectedProcedure.query(async ({ ctx }): Promise<PromptTemplateItem[]> => {
    const { organizationId } = ctx.session

    const dbTemplates = await ctx.db.query.PromptTemplate.findMany({
      where: eq(schema.PromptTemplate.organizationId, organizationId),
      orderBy: [desc(schema.PromptTemplate.createdAt)],
    })

    return dbTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      categories: t.categories,
      icon: t.icon,
      type: 'user',
    }))
  }),

  /**
   * List all system templates for the gallery/browse dialog.
   * Includes an `installed` flag indicating if the org has already installed each template.
   */
  listSystem: protectedProcedure.query(async ({ ctx }): Promise<SystemTemplateGalleryItem[]> => {
    const { organizationId } = ctx.session

    const systemTemplates = listPromptTemplates()

    // Find which system templates this org has already installed (by matching name)
    const orgTemplates = await ctx.db.query.PromptTemplate.findMany({
      where: eq(schema.PromptTemplate.organizationId, organizationId),
      columns: { name: true },
    })
    const installedNames = new Set(orgTemplates.map((r) => r.name))

    return systemTemplates.map((t) => ({
      ...t,
      installed: installedNames.has(t.name),
    }))
  }),

  /**
   * Install a system template — copies it to the DB as a user template for the org.
   * Optionally accepts a custom prompt override (for editing before install).
   */
  install: protectedProcedure
    .input(
      z.object({
        systemTemplateId: z.string(),
        prompt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const systemTemplate = getPromptTemplateById(input.systemTemplateId)

      if (!systemTemplate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'System template not found' })
      }

      const [template] = await ctx.db
        .insert(schema.PromptTemplate)
        .values({
          name: systemTemplate.name,
          description: systemTemplate.description,
          prompt: input.prompt ?? systemTemplate.prompt,
          categories: systemTemplate.categories,
          icon: systemTemplate.icon,
          organizationId,
          createdById: userId,
        })
        .returning()

      return template
    }),

  /** Create a custom org-specific prompt template */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        description: z.string().min(1, 'Description is required'),
        prompt: z.string().min(1, 'Prompt is required'),
        categories: z.array(z.string()).default([]),
        icon: z.object({ iconId: z.string(), color: z.string() }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const [template] = await ctx.db
        .insert(schema.PromptTemplate)
        .values({
          name: input.name.trim(),
          description: input.description.trim(),
          prompt: input.prompt.trim(),
          categories: input.categories,
          icon: input.icon,
          organizationId,
          createdById: userId,
        })
        .returning()

      return template
    }),

  /** Update a custom prompt template (user-created only) */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        prompt: z.string().min(1).optional(),
        categories: z.array(z.string()).optional(),
        icon: z.object({ iconId: z.string(), color: z.string() }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const existing = await ctx.db.query.PromptTemplate.findFirst({
        where: and(
          eq(schema.PromptTemplate.id, input.id),
          eq(schema.PromptTemplate.organizationId, organizationId)
        ),
      })

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Prompt template not found or is a system template',
        })
      }

      const updateData: Record<string, unknown> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.description !== undefined) updateData.description = input.description.trim()
      if (input.prompt !== undefined) updateData.prompt = input.prompt.trim()
      if (input.categories !== undefined) updateData.categories = input.categories
      if (input.icon !== undefined) updateData.icon = input.icon

      const [updated] = await ctx.db
        .update(schema.PromptTemplate)
        .set(updateData)
        .where(eq(schema.PromptTemplate.id, input.id))
        .returning()

      return updated
    }),

  /** Delete a custom prompt template (user-created only) */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const existing = await ctx.db.query.PromptTemplate.findFirst({
        where: and(
          eq(schema.PromptTemplate.id, input.id),
          eq(schema.PromptTemplate.organizationId, organizationId)
        ),
      })

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Prompt template not found or is a system template',
        })
      }

      await ctx.db.delete(schema.PromptTemplate).where(eq(schema.PromptTemplate.id, input.id))

      return { success: true }
    }),
})

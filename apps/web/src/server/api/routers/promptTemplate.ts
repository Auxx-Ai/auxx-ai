// apps/web/src/server/api/routers/promptTemplate.ts

import { schema } from '@auxx/database'
import type { PromptTemplateItem } from '@auxx/lib/prompt-templates'
import { listPromptTemplates } from '@auxx/lib/prompt-templates'
import { TRPCError } from '@trpc/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const promptTemplateRouter = createTRPCRouter({
  /**
   * List all prompt templates — merges built-in (system) + org-specific (user) templates.
   * System templates come first, then user templates sorted by createdAt desc.
   */
  list: protectedProcedure.query(async ({ ctx }): Promise<PromptTemplateItem[]> => {
    const { organizationId } = ctx.session

    // Built-in templates from code
    const systemTemplates: PromptTemplateItem[] = listPromptTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      categories: t.categories,
      icon: t.icon,
      type: 'system',
    }))

    // Org-specific templates from DB
    const dbTemplates = await ctx.db.query.PromptTemplate.findMany({
      where: eq(schema.PromptTemplate.organizationId, organizationId),
      orderBy: [desc(schema.PromptTemplate.createdAt)],
    })

    const userTemplates: PromptTemplateItem[] = dbTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      prompt: t.prompt,
      categories: t.categories,
      icon: t.icon,
      type: 'user',
    }))

    return [...systemTemplates, ...userTemplates]
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

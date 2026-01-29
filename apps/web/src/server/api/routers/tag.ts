// server/api/routers/tag.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TagService } from '@auxx/lib/tags'
// import { TagService } from '~/server/services/tag-service'

export const tagRouter = createTRPCRouter({
  // Get all tags for an organization
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session
    const tagService = new TagService(organizationId, userId, ctx.db)
    return await tagService.getAllTags()
  }),

  /**
   * Search tags by name for autocomplete.
   * Returns tags matching the query with id and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      const allTags = await tagService.getAllTags()

      // Filter tags by query (case-insensitive)
      const query = input.query.toLowerCase()
      const filtered = allTags
        .filter((tag) => tag.title.toLowerCase().includes(query))
        .slice(0, 10)
        .map((tag) => ({
          id: tag.id,
          name: tag.title,
        }))

      return filtered
    }),

  // Get tag hierarchy
  getHierarchy: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, userId } = ctx.session
    const tagService = new TagService(organizationId, userId, ctx.db)
    return await tagService.getTagHierarchy()
  }),

  // Create a new tag
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        emoji: z.string().optional(),
        color: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.createTag({ ...input })
    }),

  // Update an existing tag
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        emoji: z.string().optional().nullable(),
        color: z.string().optional().nullable(),
        parentId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)

      const { id, ...data } = input
      return await tagService.updateTag(id, data)
    }),

  // Delete a tag
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.deleteTag(input.id)
    }),

  // NOTE: Tag assignment endpoints (tagEntity, untagEntity, updateEntityTags, etc.) have been removed.
  // Tags are now assigned to entities via the RELATIONSHIP field type using FieldValue storage.
  // Use useSaveFieldValue hook with fieldType='RELATIONSHIP' for tag assignment.
})

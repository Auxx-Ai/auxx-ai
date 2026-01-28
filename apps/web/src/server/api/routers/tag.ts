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

  // Tag an entity
  tagEntity: protectedProcedure
    .input(
      z.object({
        tagId: z.union([z.string(), z.array(z.string())]),
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        entityId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)

      if (Array.isArray(input.tagId)) {
        return Promise.all(
          input.tagId.map((tagId) => {
            return tagService.tagEntity({
              tagId,
              entityType: input.entityType,
              entityId: input.entityId,
              createdBy: userId,
            })
          })
        )
      } else {
        return await tagService.tagEntity({
          tagId: input.tagId,
          entityType: input.entityType,
          entityId: input.entityId,
          createdBy: userId,
        })
      }
    }),

  // Untag an entity
  untagEntity: protectedProcedure
    .input(
      z.object({
        tagId: z.string(),
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        entityId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.untagEntity(input)
    }),

  // Get tags for an entity
  getEntityTags: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        entityId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.getEntityTags(input)
    }),

  // Find entities by tags (filter)
  findEntitiesByTags: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        tagIds: z.array(z.string()),
        requireAll: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.findEntitiesByTags({
        ...input,
        // organizationId: ctx.session.user.organizationId,
      })
    }),

  // Batch tag multiple entities
  batchTagEntities: protectedProcedure
    .input(
      z.object({
        tagId: z.string(),
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        entityIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.batchTagEntities({ ...input, createdBy: ctx.session.user.id })
    }),

  // Update entity tags (set complete list)
  updateEntityTags: protectedProcedure
    .input(
      z.object({
        tagIds: z.array(z.string()),
        entityType: z.enum(['thread', 'ticket', 'contact', 'article']),
        entityId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const tagService = new TagService(organizationId, userId, ctx.db)
      return await tagService.updateEntityTags({ ...input, createdBy: userId })
    }),
})

// server/api/routers/tag.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TagService } from '@auxx/lib/tags'
import { type RecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'

/** Zod schema for RecordId (format: "entityDefId:instanceId") */
const recordIdSchema = z
  .string()
  .refine((val): val is RecordId => val.includes(':'), {
    message: 'RecordId must be in format "entityDefId:instanceId"',
  })

export const tagRouter = createTRPCRouter({
  /**
   * Get all tags for an organization.
   * Returns tags with recordId for use in relationships.
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, user } = ctx.session
    const tagService = new TagService(organizationId, user.id, ctx.db)

    return tagService.getAllTags()
  }),

  /**
   * Search tags by name for autocomplete.
   * Returns tags matching the query with recordId and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.searchTags(input.query)
    }),

  /**
   * Get tag hierarchy - builds a tree structure from flat tag list.
   */
  getHierarchy: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId, user } = ctx.session
    const tagService = new TagService(organizationId, user.id, ctx.db)

    return tagService.getTagHierarchy()
  }),

  /**
   * Create a new tag.
   * parentId should be a RecordId if provided.
   */
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        emoji: z.string().optional(),
        color: z.string().optional(),
        parentId: recordIdSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      try {
        return await tagService.createTag({
          ...input,
          parentId: input.parentId as RecordId | undefined,
        })
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create tag',
        })
      }
    }),

  /**
   * Update an existing tag.
   * Takes recordId instead of plain id.
   */
  update: protectedProcedure
    .input(
      z.object({
        recordId: recordIdSchema,
        title: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        emoji: z.string().optional().nullable(),
        color: z.string().optional().nullable(),
        parentId: recordIdSchema.optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      const { recordId, parentId, ...data } = input

      try {
        return await tagService.updateTag(recordId as RecordId, {
          ...data,
          parentId: parentId as RecordId | null | undefined,
        })
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update tag',
        })
      }
    }),

  /**
   * Delete a tag.
   * Takes recordId instead of plain id.
   */
  delete: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      try {
        await tagService.deleteTag(input.recordId as RecordId)
        return { recordId: input.recordId, deleted: true }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to delete tag',
        })
      }
    }),

  // NOTE: Tag assignment endpoints (tagEntity, untagEntity, updateEntityTags, etc.) have been removed.
  // Tags are now assigned to entities via the RELATIONSHIP field type using FieldValue storage.
  // Use useSaveFieldValue hook with fieldType='RELATIONSHIP' for tag assignment.
})

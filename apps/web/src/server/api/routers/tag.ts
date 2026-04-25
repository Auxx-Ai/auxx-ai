// server/api/routers/tag.ts

import { TagService } from '@auxx/lib/tags'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

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

  // NOTE: Tag create / update / delete endpoints have been removed.
  // The tag UI uses api.record.create, useSaveFieldValue (api.fieldValue.setBulk),
  // and api.record.delete instead. Tag-to-entity assignments use the RELATIONSHIP
  // field type via useSaveFieldValue with fieldType='RELATIONSHIP'.
})

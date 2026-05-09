// server/api/routers/tag.ts

import { TagService } from '@auxx/lib/tags'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const scopeSchema = z.enum(['thread', 'article']).optional()

export const tagRouter = createTRPCRouter({
  /**
   * Get all tags for an organization.
   * Returns tags with recordId for use in relationships.
   */
  getAll: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.getAllTags({ scope: input?.scope })
    }),

  /**
   * Search tags by name for autocomplete.
   * Returns tags matching the query with recordId and name for FilterRef.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string(), scope: scopeSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.searchTags(input.query, undefined, { scope: input.scope })
    }),

  /**
   * Get tag hierarchy - builds a tree structure from flat tag list.
   */
  getHierarchy: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      const tagService = new TagService(organizationId, user.id, ctx.db)

      return tagService.getTagHierarchy({ scope: input?.scope })
    }),

  // NOTE: Tag create / update / delete endpoints have been removed.
  // The tag UI uses api.record.create, useSaveFieldValue (api.fieldValue.setBulk),
  // and api.record.delete instead. Tag-to-entity assignments use the RELATIONSHIP
  // field type via useSaveFieldValue with fieldType='RELATIONSHIP'.
})

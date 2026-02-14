// ~/server/api/routers/timeline.ts

import * as schema from '@auxx/database'
import { TimelineService } from '@auxx/lib/timeline'
import {
  getDefinitionId,
  isSystemModelType,
  parseRecordId,
  recordIdSchema,
} from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

export const timelineRouter = createTRPCRouter({
  /** Get timeline for an entity */
  getTimeline: protectedProcedure
    .input(
      z.object({
        recordId: recordIdSchema,
        cursor: z.string().optional(),
        limit: z.number().min(1).max(200).default(100),
        isGroupingDisabled: z.boolean().optional().default(false),
        actorFilter: z.array(z.string()).optional(),
        eventTypeFilter: z.array(z.string()).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId } = ctx.session
        const timelineService = new TimelineService(ctx.db)

        // Parse recordId to get components for permission check
        const entityDefinitionId = getDefinitionId(input.recordId)

        // Permission check for custom entities (non-system types)
        if (!isSystemModelType(entityDefinitionId)) {
          const { entityInstanceId } = parseRecordId(input.recordId)

          // Verify the entity instance belongs to this organization
          const instance = await ctx.db.query.EntityInstance.findFirst({
            where: and(
              eq(schema.EntityInstance.id, entityInstanceId),
              eq(schema.EntityInstance.organizationId, organizationId)
            ),
            columns: { id: true, entityDefinitionId: true },
          })

          if (!instance) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Entity instance not found',
            })
          }

          if (instance.entityDefinitionId !== entityDefinitionId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Entity type mismatch',
            })
          }
        }

        return await timelineService.getTimeline({
          organizationId,
          recordId: input.recordId,
          cursor: input.cursor,
          limit: input.limit,
          isGroupingDisabled: input.isGroupingDisabled,
          actorFilter: input.actorFilter,
          eventTypeFilter: input.eventTypeFilter,
        })
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }
    }),

  /** Get related timeline (e.g., all contact events for a ticket) */
  getRelatedTimeline: protectedProcedure
    .input(
      z.object({
        relatedRecordId: recordIdSchema,
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId } = ctx.session
        const timelineService = new TimelineService(ctx.db)

        return await timelineService.getRelatedTimeline(
          organizationId,
          input.relatedRecordId,
          input.limit
        )
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }
    }),
})

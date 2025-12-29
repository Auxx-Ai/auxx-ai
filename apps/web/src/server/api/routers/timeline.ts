// ~/server/api/routers/timeline.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import {
  TimelineService,
  isSystemEntityType,
  isCustomEntityType,
  getEntityDefinitionId,
} from '@auxx/lib/timeline'
import { and, eq } from 'drizzle-orm'
import * as schema from '@auxx/database'

/** Validate entityType is either a system type or custom entity type */
const entityTypeSchema = z
  .string()
  .min(1)
  .refine((val) => isSystemEntityType(val) || isCustomEntityType(val), {
    message: 'entityType must be a valid system type or custom entity type (entity:id)',
  })

export const timelineRouter = createTRPCRouter({
  /** Get timeline for an entity */
  getTimeline: protectedProcedure
    .input(
      z.object({
        entityType: entityTypeSchema,
        entityId: z.string(),
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

        // Permission check for custom entities
        if (isCustomEntityType(input.entityType)) {
          const entityDefinitionId = getEntityDefinitionId(input.entityType)
          if (entityDefinitionId) {
            // Verify the entity instance belongs to this organization
            const instance = await ctx.db.query.EntityInstance.findFirst({
              where: and(
                eq(schema.EntityInstance.id, input.entityId),
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
        }

        return await timelineService.getTimeline({
          organizationId,
          ...input,
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
        relatedEntityType: z.string(),
        relatedEntityId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const { organizationId } = ctx.session
        const timelineService = new TimelineService(ctx.db)

        return await timelineService.getRelatedTimeline(
          organizationId,
          input.relatedEntityType,
          input.relatedEntityId,
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

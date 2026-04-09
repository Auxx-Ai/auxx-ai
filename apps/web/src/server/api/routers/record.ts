// apps/web/src/server/api/routers/record.ts

import { schema } from '@auxx/database'
import { getCachedResource } from '@auxx/lib/cache'
import { conditionGroupSchema } from '@auxx/lib/conditions'
import { getDescendantIds } from '@auxx/lib/field-values'
import { RESOURCE_TABLE_REGISTRY, UnifiedCrudHandler } from '@auxx/lib/resources'
import { type FieldId, parseResourceFieldId, resourceFieldIdSchema } from '@auxx/types/field'
import {
  ENTITY_DEFINITION_TYPES,
  parseRecordId,
  type RecordId,
  recordIdSchema,
  toRecordId,
} from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Extract socket ID from tRPC context headers for realtime self-event exclusion. */
function getSocketId(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

/**
 * Validate entity definition ID - accepts system TableId, new system entity type, or custom entity UUID
 */
const entityDefinitionIdSchema = z.string().refine(
  (val: string) => {
    // System table IDs (thread, user, inbox, etc.)
    if (RESOURCE_TABLE_REGISTRY.some((r: { id: string }) => r.id === val)) return true
    // New system entity types (tag, contact, ticket, etc.) - resolved to UUIDs downstream
    if (ENTITY_DEFINITION_TYPES.includes(val as any)) return true
    // Custom entity IDs - UUID format (cuid2 minimum length)
    if (val.length >= 20) return true
    return false
  },
  {
    message:
      'Invalid resource ID. Must be system TableId, system entity type, or EntityDefinitionId (UUID).',
  }
)

/**
 * Schema for global search endpoint
 */
const globalSearchInputSchema = z.object({
  /** Optional - if provided, searches specific resource (system or custom entity) */
  entityDefinitionId: entityDefinitionIdSchema.optional(),
  /** Optional - resolve by apiSlug instead of entityDefinitionId */
  apiSlug: z.string().optional(),
  /** Optional search query - if empty, returns first N records */
  query: z.string().max(500).optional().default(''),
  /** Max results per page */
  limit: z.number().min(1).max(100).default(25),
  /** Cursor for pagination */
  cursor: z.string().optional(),
  /** Optional - filter to specific entity definitions (only used in global search mode) */
  entityDefinitionIds: z.array(z.string()).optional(),
})

/**
 * Input for getById using RecordId
 */
const getByIdInputSchema = z.object({
  recordId: recordIdSchema,
})

/**
 * Input for legacy getById using separate params
 */
const getByIdLegacyInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  id: z.string(),
})

/**
 * Input for create mutation
 */
const createInputSchema = z.object({
  entityDefinitionId: z.string(),
  values: z.record(z.string(), z.any()).optional(),
})

/**
 * Input for update mutation
 */
const updateInputSchema = z.object({
  recordId: recordIdSchema,
  values: z.record(z.string(), z.any()),
})

/**
 * Record router - handles individual record operations (instances of resources)
 * Unified CRUD operations for both system entities (contact, ticket) and custom entities.
 */
export const recordRouter = createTRPCRouter({
  // ─────────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get single record by RecordId
   */
  getById: protectedProcedure
    .input(getByIdInputSchema.or(getByIdLegacyInputSchema))
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))

        // Handle both RecordId and legacy separate params
        let recordId: RecordId
        if ('recordId' in input) {
          recordId = input.recordId
        } else {
          recordId = toRecordId(input.entityDefinitionId, input.id)
        }

        const result = await handler.getById(recordId)
        if (!result) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Record not found: ${recordId}`,
          })
        }

        return result
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch record: ${error.message}`,
        })
      }
    }),

  /**
   * Get multiple records by IDs (batch)
   * Used for hydrating relationship field values
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        items: z.array(recordIdSchema).max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.getByIds(input.items as RecordId[])
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch records by IDs: ${message}`,
        })
      }
    }),

  /**
   * Search records with optional global search support
   */
  search: protectedProcedure.input(globalSearchInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    const { apiSlug, entityDefinitionId, query, limit, cursor, entityDefinitionIds } = input

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))

      // Handler handles all resolution internally (apiSlug -> entityDefinitionId, system names -> UUIDs)
      return await handler.search({
        query: query || '',
        apiSlug,
        entityDefinitionId,
        entityDefinitionIds,
        limit,
        cursor,
      })
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      if (error.message?.includes('not found')) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error.message,
        })
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Search failed: ${error.message}`,
      })
    }
  }),

  /**
   * List record IDs with server-side filtering (Query Snapshot pattern)
   * Returns cached snapshot IDs for efficient pagination
   */
  listFiltered: protectedProcedure
    .input(
      z.object({
        /** Resource type: 'contact', 'ticket', 'entity_xxx' */
        entityDefinitionId: z.string(),
        /** Filter groups (optional) */
        filters: z.array(conditionGroupSchema).optional(),
        /** Sort configuration (optional) */
        sorting: z
          .array(
            z.object({
              id: z.string(),
              desc: z.boolean(),
            })
          )
          .optional(),
        /** Limit per request */
        limit: z.number().min(1).max(500).default(100),
        /** Cursor for infinite query pagination (typed object) */
        cursor: z
          .object({
            snapshotId: z.string(),
            offset: z.number(),
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
      return handler.listFiltered({
        entityDefinitionId: input.entityDefinitionId,
        filters: input.filters,
        sorting: input.sorting,
        limit: input.limit,
        cursor: input.cursor,
      })
    }),

  /**
   * List all records with field values (for small datasets like tags, inboxes)
   * Supports resolution of entityDefinitionId ('tag' → UUID) or apiSlug ('tags' → UUID)
   */
  listAll: protectedProcedure
    .input(
      z.object({
        /** Entity definition ID - can be UUID or type like 'tag', 'contact' */
        entityDefinitionId: z.string().optional(),
        /** API slug like 'tags', 'contacts' */
        apiSlug: z.string().optional(),
        /** Specific field IDs to fetch (all if undefined) - branded FieldId type */
        fieldIds: z.array(z.string() as unknown as z.ZodType<FieldId>).optional(),
        /** Include archived records */
        includeArchived: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.listAll(input)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to list records: ${message}`,
        })
      }
    }),

  // ─────────────────────────────────────────────────────────────────
  // MUTATIONS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new entity instance with optional field values
   */
  create: protectedProcedure.input(createInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
      return await handler.create(input.entityDefinitionId, input.values ?? {})
    } catch (error: any) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create record: ${error.message}`,
      })
    }
  }),

  /**
   * Update entity instance field values
   */
  update: protectedProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session

    try {
      const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
      return await handler.update(input.recordId, input.values)
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error.message,
        })
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to update record: ${error.message}`,
      })
    }
  }),

  /**
   * Archive entity instance (soft delete)
   */
  archive: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.archive(input.recordId)
      } catch (error: any) {
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to archive record: ${error.message}`,
        })
      }
    }),

  /**
   * Restore archived entity instance
   */
  restore: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.restore(input.recordId)
      } catch (error: any) {
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to restore record: ${error.message}`,
        })
      }
    }),

  /**
   * Permanently delete entity instance
   */
  delete: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        await handler.delete(input.recordId)
        return { success: true }
      } catch (error: any) {
        if (error.message?.includes('not found')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to delete record: ${error.message}`,
        })
      }
    }),

  /**
   * Bulk archive entity instances
   */
  bulkArchive: protectedProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.bulkArchive(input.recordIds)
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to bulk archive records: ${error.message}`,
        })
      }
    }),

  /**
   * Bulk delete entity instances
   */
  bulkDelete: protectedProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        const result = await handler.bulkDelete(input.recordIds)

        if (result.errors.length > 0 && result.count === 0) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to delete ${result.errors.length} record(s): ${result.errors[0]?.message}`,
          })
        }

        return result
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to bulk delete records: ${error.message}`,
        })
      }
    }),

  /**
   * Merge multiple entity instances into a target instance
   */
  merge: protectedProcedure
    .input(
      z.object({
        targetRecordId: recordIdSchema,
        sourceRecordIds: z.array(recordIdSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.merge(input.targetRecordId, input.sourceRecordIds)
      } catch (error: any) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to merge records: ${error.message}`,
        })
      }
    }),

  /**
   * Invalidate cache (for testing/admin)
   */
  invalidateCache: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: entityDefinitionIdSchema,
        id: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        await handler.invalidateCache(input.entityDefinitionId, input.id)
        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to invalidate cache: ${message}`,
        })
      }
    }),

  /**
   * Get all descendant RecordIds for self-referential relationship filtering.
   * Used by UI to exclude invalid options (self + descendants) from picker.
   */
  getDescendantRecordIds: protectedProcedure
    .input(
      z.object({
        recordId: recordIdSchema,
        resourceFieldId: resourceFieldIdSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        // Parse composite IDs to get raw values for DB query
        const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId as RecordId)
        const { fieldId } = parseResourceFieldId(input.resourceFieldId)

        // Get field from org cache
        const resource = await getCachedResource(organizationId, entityDefinitionId)
        const field = resource?.fields.find((f) => f.key === fieldId || f.id === fieldId)

        if (!field?.id) return []

        const descendantInstanceIds = await getDescendantIds(
          { db: ctx.db, organizationId },
          entityInstanceId,
          field.id
        )

        // Convert back to RecordIds for client
        return [...descendantInstanceIds].map((instanceId) =>
          toRecordId(entityDefinitionId, instanceId)
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to get descendant record IDs: ${message}`,
        })
      }
    }),
})

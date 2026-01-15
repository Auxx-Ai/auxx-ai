// apps/web/src/server/api/routers/resource.ts

import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import {
  ResourcePickerService,
  ResourceRegistryService,
  RESOURCE_TABLE_REGISTRY,
  RESOURCE_TABLE_MAP,
  type TableId,
} from '@auxx/lib/resources'
import { conditionGroupSchema, type ConditionGroup } from '@auxx/lib/conditions'
import { getOrCreateSnapshot, getSnapshotChunk, invalidateSnapshots } from '@auxx/lib/snapshot'
import {
  systemConditionBuilder,
  entityConditionBuilder,
  type EntityQueryContext,
} from '@auxx/lib/workflow-engine'
import { type Database, schema } from '@auxx/database'
import { eq, and, isNull } from 'drizzle-orm'
import { resourceIdSchema, type ResourceId } from '@auxx/types/resource'

/**
 * Validate entity definition ID - accepts system TableId or custom entity UUID
 */
const entityDefinitionIdSchema = z.string().refine(
  (val: string) => {
    // System table IDs
    if (RESOURCE_TABLE_REGISTRY.some((r: { id: string }) => r.id === val)) return true
    // Custom entity IDs - UUID format (cuid2 minimum length)
    if (val.length >= 20) return true
    return false
  },
  { message: 'Invalid resource ID. Must be system TableId or EntityDefinitionId (UUID).' }
)

const getResourcesInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().nullish(),
  search: z.string().optional(),
  filters: z.record(z.string(), z.any()).optional(),
  skipCache: z.boolean().optional(),
})

/**
 * Schema for global search endpoint
 * entityDefinitionId is optional - if not provided, searches all EntityInstances
 * query is optional - if empty, returns first N records
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

const getResourceByIdInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  id: z.string(),
})

export const resourceRouter = createTRPCRouter({
  /**
   * Get paginated resources for picker
   * Accepts entityDefinitionId (system resource ID or custom entity UUID)
   */
  getAll: protectedProcedure.input(getResourcesInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const { entityDefinitionId } = input

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      return await service.getResources({ ...input, entityDefinitionId })
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resources: ${error.message}`,
      })
    }
  }),

  /**
   * Get single resource by ID
   */
  getById: protectedProcedure.input(getResourceByIdInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      const item = await service.getResourceById(input)

      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Resource not found: ${input.entityDefinitionId}:${input.id}`,
        })
      }

      return item
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resource: ${error.message}`,
      })
    }
  }),

  /**
   * Get multiple resources by IDs (batch)
   * Used for hydrating relationship field values
   */
  getByIds: protectedProcedure
    .input(
      z.object({
        items: z.array(resourceIdSchema).max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)
        return await service.getResourcesByIds(input.items as ResourceId[])
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch resources by IDs: ${message}`,
        })
      }
    }),

  /**
   * Search resources with optional global search support
   *
   * Behavior:
   * - With entityDefinitionId (system resource like 'contact'): Use existing getResources() with search
   * - With entityDefinitionId (custom entity): Use new search() with full-text search
   * - Without entityDefinitionId: Global search across all EntityInstances
   */
  search: protectedProcedure.input(globalSearchInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    let { entityDefinitionId } = input
    const { apiSlug, query, limit, cursor, entityDefinitionIds } = input

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)

      // Resolve apiSlug to entityDefinitionId if provided
      if (apiSlug && !entityDefinitionId) {
        const registryService = new ResourceRegistryService(organizationId, ctx.db)
        const resource = await registryService.getByApiSlug(apiSlug)
        if (!resource) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Entity not found: ${apiSlug}`,
          })
        }
        entityDefinitionId = resource.id
      }

      // If entityDefinitionId provided, check if it's a system resource
      if (entityDefinitionId) {
        const isSystemResource = RESOURCE_TABLE_MAP[entityDefinitionId as TableId]

        if (isSystemResource) {
          // System resource - use existing getResources() with client-side search
          // Pass search only if query is non-empty
          const result = await service.getResources({
            entityDefinitionId,
            limit,
            cursor: cursor ?? null,
            search: query || undefined,
          })
          return {
            ...result,
            hasMore: result.nextCursor !== null,
            processingTimeMs: 0,
            query: query || '',
          }
        }

        // Custom entity - use new search() with full-text search
        return await service.search({
          query: query || '',
          entityDefinitionId,
          limit,
          cursor,
        })
      }

      // No entityDefinitionId - global search across all EntityInstances
      return await service.search({
        query: query || '',
        entityDefinitionIds,
        limit,
        cursor,
      })
    } catch (error: any) {
      if (error instanceof TRPCError) throw error
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Search failed: ${error.message}`,
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
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)

        if (input.id) {
          await service.invalidateCacheById(input.entityDefinitionId, input.id)
        } else {
          await service.invalidateCacheByTable(input.entityDefinitionId)
        }

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
   * Get all available resource types (system + custom entities)
   * Returns resources with apiSlug for custom entities (used for mapping)
   */
  getAllResourceTypes: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    try {
      const service = new ResourceRegistryService(organizationId, ctx.db)
      const resources = await service.getAll()

      return resources
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to fetch resource types: ${message}`,
      })
    }
  }),

  /**
   * List resource IDs with server-side filtering (Query Snapshot pattern)
   * Returns cached snapshot IDs for efficient pagination
   *
   * Supports tRPC infinite query via typed cursor object
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
      const { organizationId } = ctx.session

      // Extract pagination from cursor if provided
      const snapshotId = input.cursor?.snapshotId
      const offset = input.cursor?.offset ?? 0

      // If snapshotId provided via cursor, try to fetch chunk from cacheb
      if (snapshotId) {
        const chunk = await getSnapshotChunk({
          snapshotId,
          offset,
          limit: input.limit,
        })

        if (chunk) {
          return {
            snapshotId,
            ids: chunk.ids,
            total: chunk.total,
            hasMore: offset + chunk.ids.length < chunk.total,
          }
        }
        // Snapshot expired - fall through to create a new one
        // Note: We'll start from offset 0 since this is a fresh snapshot
      }

      // No snapshotId - create new snapshot
      const result = await getOrCreateSnapshot({
        organizationId,
        resourceType: input.entityDefinitionId,
        filters: (input.filters ?? []) as ConditionGroup[],
        sorting: input.sorting ?? [],
        executeQuery: async () => {
          // Route to appropriate query function
          // Check if system resource first
          if (RESOURCE_TABLE_REGISTRY.some((r) => r.id === input.entityDefinitionId)) {
            console.log('Querying system resource IDs for', input.entityDefinitionId)
            return querySystemResourceIds({
              db: ctx.db,
              tableId: input.entityDefinitionId as TableId,
              organizationId,
              filters: (input.filters ?? []) as ConditionGroup[],
              sorting: input.sorting ?? [],
            })
          }

          // Otherwise treat as custom entity (UUID)
          return queryEntityInstanceIds({
            db: ctx.db,
            entityDefinitionId: input.entityDefinitionId,
            organizationId,
            filters: (input.filters ?? []) as ConditionGroup[],
            sorting: input.sorting ?? [],
          })
        },
      })

      // Return first chunk
      const ids = result.ids.slice(offset, offset + input.limit)

      return {
        snapshotId: result.snapshotId,
        ids,
        total: result.total,
        hasMore: offset + ids.length < result.total,
        fromCache: result.fromCache,
      }
    }),
})

// ─────────────────────────────────────────────────────────────────
// QUERY HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Query entity instance IDs using EntityConditionBuilder
 */
async function queryEntityInstanceIds(params: {
  db: Database
  entityDefinitionId: string
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
}): Promise<string[]> {
  const { db, entityDefinitionId, organizationId, filters, sorting } = params

  // Get fields for this entity via ResourceRegistryService (entityDefinitionId is now UUID, no prefix)
  const registryService = new ResourceRegistryService(organizationId, db)
  const fields = await registryService.getFieldsForResource(entityDefinitionId)

  // Build WHERE clause using existing EntityConditionBuilder
  const context: EntityQueryContext = {
    fields,
    outerTable: schema.EntityInstance,
  }

  const whereClause = entityConditionBuilder.buildGroupedQuery(filters, context)

  // Build ORDER BY
  const orderByClauses =
    sorting.length > 0
      ? entityConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          context
        )
      : undefined

  // Execute query
  let query = db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt),
        whereClause
      )
    )
    .$dynamic()

  if (orderByClauses) {
    query = query.orderBy(...orderByClauses)
  }

  const results = await query
  return results.map((r) => r.id)
}

/**
 * Query system resource IDs using SystemConditionBuilder
 */
async function querySystemResourceIds(params: {
  db: Database
  tableId: TableId
  organizationId: string
  filters: ConditionGroup[]
  sorting: Array<{ id: string; desc: boolean }>
}): Promise<string[]> {
  const { db, tableId, organizationId, filters, sorting } = params

  // Build WHERE clause using existing SystemConditionBuilder
  const whereClause = systemConditionBuilder.buildGroupedQuery(filters, tableId)

  // Build ORDER BY
  const orderByClauses =
    sorting.length > 0
      ? systemConditionBuilder.buildOrderBySql(
          sorting[0].id,
          sorting[0].desc ? 'desc' : 'asc',
          tableId
        )
      : undefined

  // Get the table schema
  const tableSchema = getTableSchema(tableId)
  if (!tableSchema) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown table: ${tableId}` })
  }

  // Execute query
  let query = db
    .select({ id: tableSchema.id })
    .from(tableSchema)
    .where(and(eq(tableSchema.organizationId, organizationId), whereClause))
    .$dynamic()

  if (orderByClauses) {
    query = query.orderBy(...orderByClauses)
  }

  const results = await query
  return results.map((r) => r.id)
}

/**
 * Get Drizzle table schema for a system resource
 */
function getTableSchema(tableId: TableId) {
  const tableInfo = RESOURCE_TABLE_MAP[tableId]
  if (!tableInfo) return undefined

  const tableMap: Record<string, any> = {
    Contact: schema.Contact,
    Ticket: schema.Ticket,
    Inbox: schema.Inbox,
    User: schema.User,
    Thread: schema.Thread,
    Message: schema.Message,
    Participant: schema.Participant,
    Dataset: schema.Dataset,
    Part: schema.Part,
  }

  return tableMap[tableInfo.dbName]
}

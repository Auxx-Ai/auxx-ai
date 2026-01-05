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
import { eq, and } from 'drizzle-orm'

/**
 * Validate resource ID - accepts system TableId or custom entity UUID
 */
const resourceIdSchema = z.string().refine(
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
  tableId: resourceIdSchema,
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().nullish(),
  search: z.string().optional(),
  filters: z.record(z.string(), z.any()).optional(),
  skipCache: z.boolean().optional(),
})

const getResourceByIdInputSchema = z.object({
  tableId: resourceIdSchema,
  id: z.string(),
})

export const resourceRouter = createTRPCRouter({
  /**
   * Get paginated resources for picker
   * Accepts tableId (system resource ID or custom entity UUID)
   */
  getAll: protectedProcedure.input(getResourcesInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const { tableId } = input

    try {
      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      return await service.getResources({ ...input, tableId })
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
          message: `Resource not found: ${input.tableId}:${input.id}`,
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
        items: z
          .array(
            z.object({
              resourceId: z.string(), // TableId or entity_<slug>
              id: z.string(),
            })
          )
          .max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)
        return await service.getResourcesByIds(input.items)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch resources by IDs: ${message}`,
        })
      }
    }),

  /**
   * Search resources (alias for getAll with semantic meaning)
   * Accepts either tableId (entity_products, contact) or apiSlug (products)
   */
  search: protectedProcedure.input(getResourcesInputSchema).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    let { tableId } = input
    const { apiSlug } = input

    try {
      // Resolve apiSlug to tableId if provided
      if (apiSlug && !tableId) {
        const registryService = new ResourceRegistryService(organizationId, ctx.db)
        const resource = await registryService.getByApiSlug(apiSlug)
        if (!resource) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Entity not found: ${apiSlug}`,
          })
        }
        tableId = resource.id
      }

      const service = new ResourcePickerService(organizationId, userId, ctx.db)
      return await service.getResources({ ...input, tableId: tableId! })
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
        tableId: resourceIdSchema,
        id: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      try {
        const service = new ResourcePickerService(organizationId, userId, ctx.db)

        if (input.id) {
          await service.invalidateCacheById(input.tableId, input.id)
        } else {
          await service.invalidateCacheByTable(input.tableId)
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
        tableId: z.string(),
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

      // If snapshotId provided via cursor, fetch chunk from cache
      if (snapshotId) {
        const chunk = await getSnapshotChunk({
          snapshotId,
          offset,
          limit: input.limit,
        })

        if (!chunk) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Filter snapshot expired, please refresh',
          })
        }

        return {
          snapshotId,
          ids: chunk.ids,
          total: chunk.total,
          hasMore: offset + chunk.ids.length < chunk.total,
        }
      }

      // No snapshotId - create new snapshot
      const result = await getOrCreateSnapshot({
        organizationId,
        resourceType: input.tableId,
        filters: (input.filters ?? []) as ConditionGroup[],
        sorting: input.sorting ?? [],
        executeQuery: async () => {
          // Route to appropriate query function
          // Check if system resource first
          if (RESOURCE_TABLE_REGISTRY.some((r) => r.id === input.tableId)) {
            return querySystemResourceIds({
              db: ctx.db,
              tableId: input.tableId as TableId,
              organizationId,
              filters: (input.filters ?? []) as ConditionGroup[],
              sorting: input.sorting ?? [],
            })
          }

          // Otherwise treat as custom entity (UUID)
          return queryEntityInstanceIds({
            db: ctx.db,
            entityDefinitionId: input.tableId,
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

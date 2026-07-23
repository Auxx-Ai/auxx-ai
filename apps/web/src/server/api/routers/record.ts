// apps/web/src/server/api/routers/record.ts

import { schema } from '@auxx/database'
import { getCachedResource } from '@auxx/lib/cache'
import { conditionGroupSchema } from '@auxx/lib/conditions'
import { BadRequestError } from '@auxx/lib/errors'
import { getDescendantIds } from '@auxx/lib/field-values'
import { getRecordIdentityViews } from '@auxx/lib/identity'
import { PermissionKey } from '@auxx/lib/permissions'
import {
  type CreateEntityResult,
  type LookupCandidate,
  RESOURCE_TABLE_REGISTRY,
  UnifiedCrudHandler,
} from '@auxx/lib/resources'
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
import { capabilityProcedure, createTRPCRouter, isAuxxError, protectedProcedure } from '../trpc'

/** Extract socket ID from tRPC context headers for realtime self-event exclusion. */
function getSocketId(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

/**
 * Postgres FK constraint blocking an invoice's instance delete while ledger rows still
 * reference it (`PaymentTransaction.invoiceInstanceId` is the only RESTRICT FK in the schema).
 */
const INVOICE_PAYMENT_FK_CONSTRAINT = 'PaymentTransaction_invoiceInstanceId_EntityInstance_id_fk'

/**
 * Defense-in-depth mapping for `record.delete`/`bulkDelete`: the invoice pre-delete hook
 * (plans/dispatch/money/12-delete-safety.md §A) purges non-succeeded ledger rows and rejects
 * succeeded/disputed ones before the instance delete runs, so this FK should be unreachable in
 * practice. If it's ever hit anyway (a future RESTRICT FK the hook doesn't know about yet, or a
 * race), rethrow as a friendly `BadRequestError` instead of the raw Postgres violation.
 *
 * Walks the error's `.cause` chain (the CRUD handler wraps DB errors — see `unwrapResult` in
 * `packages/lib/src/resources/crud/unified-handler-mutations.ts`) looking for Postgres error
 * code `23503` on this specific constraint. Any other error — including other FK violations —
 * is left untouched.
 */
function rethrowIfInvoicePaymentFkViolation(error: unknown): void {
  let current: unknown = error
  while (current && typeof current === 'object') {
    const code = (current as { code?: unknown }).code
    const constraint = (current as { constraint?: unknown }).constraint
    const message = (current as { message?: unknown }).message
    const matchesConstraint =
      constraint === INVOICE_PAYMENT_FK_CONSTRAINT ||
      (typeof message === 'string' && message.includes(INVOICE_PAYMENT_FK_CONSTRAINT))
    if (code === '23503' && matchesConstraint) {
      throw new BadRequestError('Remove recorded payments before deleting this invoice')
    }
    current = (current as { cause?: unknown }).cause
  }
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
 * Input for createMany mutation. Capped at 50 — the caller is an interactive
 * bulk add (e.g. a catalog-group explode), not an import pipeline.
 */
const createManyInputSchema = z.object({
  entityDefinitionId: z.string(),
  records: z.array(z.record(z.string(), z.any())).min(1).max(50),
})

/**
 * Input for `record.lookupByField`.
 *
 * Priority-ordered equality lookup. A candidate references its field either by
 * `systemAttribute` (system fields) or by `fieldId` (custom fields, whose
 * `systemAttribute` is null — e.g. connector-provisioned fields). Data Connectors
 * are the custom-field caller this `fieldId` variant was always meant for.
 *
 * `limit` caps distinct recordIds across ALL candidates combined (not
 * per-candidate). Default 1 ("exists or not" — the 90% case). Cap at 25
 * so callers can't turn this into a listing endpoint through the side
 * door — beyond 25 the UX should be "search in Auxx".
 */
const lookupValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
])
const lookupByFieldInputSchema = z.object({
  entityDefinitionId: entityDefinitionIdSchema,
  candidates: z
    .array(
      z.union([
        z.object({ systemAttribute: z.string().min(1), value: lookupValueSchema }),
        z.object({ fieldId: z.string().min(1), value: lookupValueSchema }),
      ])
    )
    .min(1)
    .max(5),
  limit: z.number().int().min(1).max(25).default(1),
})

/**
 * Input for update mutation.
 *
 * `values` stays `Record<fieldId, unknown>` — all existing callers keep
 * working byte-for-byte. The optional parallel `modes` map lets a single
 * call mix modes across fields (e.g. replace status, add a tag, remove an
 * externalId in one round-trip). Any field not listed in `modes` defaults
 * to `'set'` — today's behavior. Note: `'set'` on `record.update` is
 * per-field replace, not whole-record replace — fields absent from
 * `values` are left alone.
 */
const updateInputSchema = z.object({
  recordId: recordIdSchema,
  values: z.record(z.string(), z.any()),
  modes: z.record(z.string(), z.enum(['set', 'add', 'remove'])).optional(),
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
   * External identities linked to a record — the "External identities" card
   * data source (RecordIdentity index, decorated from org cache). One batch
   * query, no N+1. Values themselves still render as normal FieldValues in the
   * field grid; this surfaces the cross-system/cross-store link set.
   */
  getIdentities: protectedProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      try {
        return await getRecordIdentityViews(organizationId, input.recordId as RecordId)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch record identities: ${message}`,
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
   * Typed equality lookup by `(systemAttribute, value)` — the primitive
   * the extension uses for capture-side dedup and "already in Auxx"
   * button state. Column-aware (routes to the right FieldValue typed
   * column) and value-normalizing (EMAIL lowercased, URL protocol added,
   * PHONE_INTL to E.164 — matches write-path formatting).
   *
   * Accepts a priority list so the caller can express "externalId, else
   * primary_email" in one round-trip; without that, the extension pays
   * two iframe→API crossings per capture.
   */
  lookupByField: protectedProcedure
    .input(lookupByFieldInputSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        return await handler.lookupByField({
          entityDefinitionId: input.entityDefinitionId,
          // `fieldId` arrives as a plain string from zod; the handler brands it.
          candidates: input.candidates as LookupCandidate[],
          limit: input.limit,
        })
      } catch (error: unknown) {
        if (error instanceof BadRequestError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Lookup failed: ${message}`,
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
        /** Pagination offset — honored in oneshot mode. */
        offset: z.number().min(0).optional(),
        /**
         * Query mode: 'snapshot' (default, Redis-cached id list) or 'oneshot'
         * (paged SQL + COUNT, no snapshot) for one-shot callers like dashboard
         * widgets that don't benefit from a stable cursor.
         */
        mode: z.enum(['snapshot', 'oneshot']).optional(),
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
        offset: input.offset,
        mode: input.mode,
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
        /** Specific field output keys to fetch (ignored when fieldIds is set) */
        fieldKeys: z.array(z.string()).optional(),
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
   * Create multiple entity instances in one round-trip (plans/dispatch/31 §D).
   * Runs the exact single-create pipeline per record, in input order, and
   * returns `{ recordId, instance }` per row in the same order.
   *
   * Deliberately NOT wrapped in a DB transaction: the synchronous field-change
   * hooks (e.g. the money totals recompute, `totals-hooks.ts`) read and write
   * through pool-scoped services, so rows created inside an open transaction
   * would be invisible to their reads and their writes would FK-fail against
   * the uncommitted instances. All-or-nothing is approximated instead: a
   * mid-loop failure deletes the rows already created, then rethrows.
   */
  createMany: protectedProcedure.input(createManyInputSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, user } = ctx.session
    const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
    const created: Array<Pick<CreateEntityResult, 'recordId' | 'instance'>> = []

    try {
      for (const values of input.records) {
        const result = await handler.create(input.entityDefinitionId, values)
        created.push({ recordId: result.recordId, instance: result.instance })
      }
      return created
    } catch (error: any) {
      // Compensate best-effort — a failed cleanup delete must not mask the
      // original error, so each one is swallowed individually.
      for (const row of [...created].reverse()) {
        try {
          await handler.delete(row.recordId)
        } catch {
          // Leave the orphan; the original error below is what the user sees.
        }
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create records: ${error.message}`,
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
      return await handler.update(input.recordId, input.values, input.modes)
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
  delete: capabilityProcedure
    .input(z.object({ recordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      // Layer-2 write guard (§11.4): deleting a record requires the delete verb.
      ctx.capabilities.assert(PermissionKey.recordsDelete)

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        await handler.delete(input.recordId)
        return { success: true }
      } catch (error: any) {
        // Rethrow pre-delete-hook rejections (BadRequestError, ForbiddenError, …) so
        // auxxErrorMiddleware maps them to their proper codes — duck-typed, since
        // `instanceof` fails across the `@auxx/lib` transpile boundary (see trpc.ts).
        if (isAuxxError(error)) throw error
        rethrowIfInvoicePaymentFkViolation(error)
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
  bulkDelete: capabilityProcedure
    .input(z.object({ recordIds: z.array(recordIdSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      // Layer-2 write guard (§11.4): bulk delete requires the delete verb.
      ctx.capabilities.assert(PermissionKey.recordsDelete)

      try {
        const handler = new UnifiedCrudHandler(organizationId, user.id, ctx.db, getSocketId(ctx))
        // NOTE on friendly messages here: the invoice pre-delete hook's admin-gate /
        // succeeded-charges guard throws `BadRequestError` with an already-friendly message
        // (e.g. "Remove recorded payments before deleting this invoice") — `bulkDeleteEntities`
        // (packages/lib/src/resources/crud/unified-handler-mutations.ts) catches that per-record
        // and stores `error.message` verbatim in `result.errors`, so it reads well here with no
        // extra mapping needed.
        // The raw-FK defense-in-depth mapping (`rethrowIfInvoicePaymentFkViolation`, used in the
        // `delete` mutation above) does NOT apply here: `bulkDeleteEntities` flattens each per-record
        // failure to a plain `{ recordId, message }` string before it ever reaches this router
        // (the original error/cause chain, including the pg error code + constraint, is
        // discarded in the lib loop) — so this router has nothing left to pattern-match on for
        // that edge case in bulk mode. This should be unreachable post-§A anyway (the hook purges
        // non-succeeded ledger rows before the instance delete runs); worth revisiting only if a
        // per-record error surface is added to the lib handler.
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
  merge: capabilityProcedure
    .input(
      z.object({
        targetRecordId: recordIdSchema,
        sourceRecordIds: z.array(recordIdSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, user } = ctx.session
      // Layer-2 write guard (§11.4): merge permanently REMOVES the source records, so it gates
      // on the delete verb (chosen over recordsEdit — the destructive half is the binding one).
      ctx.capabilities.assert(PermissionKey.recordsDelete)

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

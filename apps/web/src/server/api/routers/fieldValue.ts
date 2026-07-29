// apps/web/src/server/api/routers/fieldValue.ts

import { schema } from '@auxx/database'
import { FieldValueService } from '@auxx/lib/field-values'
import type { FieldReference } from '@auxx/types/field'
import { fieldIdSchema, resourceFieldIdSchema } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { recordIdSchema } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assertFieldValueHostsWritable } from '~/server/lib/field-value-host-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/** Schema for FieldReference - either ResourceFieldId or FieldPath */
const fieldReferenceSchema = z.union([
  resourceFieldIdSchema, // Direct field: "contact:email"
  z.array(resourceFieldIdSchema).min(1), // Path: ["product:vendor", "vendor:name"]
])

/** Typed value input schema for multi-value fields */
const typedValueInputSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'date', 'json', 'option', 'relationship']),
  value: z.any().optional(),
  optionId: z.string().optional(),
  recordId: recordIdSchema.optional(), // For relationship type
})

/**
 * Field Value Router - handles all field value operations
 * Uses FieldValueService directly for all operations
 * RecordId format: "entityDefinitionId:entityInstanceId"
 */
export const fieldValueRouter = createTRPCRouter({
  /**
   * Set a single field value for a resource.
   * Expects recordId in RecordId format (entityDefinitionId:entityInstanceId).
   */
  set: capabilityProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
        value: z.any().nullable(),
        /**
         * Stage 1 AI request. When true, the service short-circuits and
         * enqueues a BullMQ autofill job instead of writing a literal
         * value. `value` is ignored in this mode.
         */
        ai: z.boolean().optional(),
        /**
         * Write mode. Default `'set'` — replaces the field's rows with
         * the input (today's behavior). `'add'` / `'remove'` route to
         * the multi-value primitives and throw `BadRequestError` on
         * single-value fields.
         */
        mode: z.enum(['set', 'add', 'remove']).default('set'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write enforcement, per host def (phase 4 §3.2 + plan 40 §5.5): the
      // def-aware edit gate for records, question 4's `full`-lens gate for
      // threads, `assertAdminInstance` for mailboxes. Throws ForbiddenError (403).
      await assertFieldValueHostsWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        hosts: [input.recordId as RecordId],
      })

      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )

      if (input.mode === 'set') {
        return await service.setValueWithBuiltIn({
          recordId: input.recordId as RecordId,
          fieldId: input.fieldId,
          value: input.value ?? null,
          ai: input.ai,
        })
      }

      const arr = Array.isArray(input.value) ? input.value : [input.value]
      if (input.mode === 'add') {
        const values = await service.addValues({
          recordId: input.recordId as RecordId,
          fieldId: input.fieldId,
          values: arr,
        })
        return { state: 'complete' as const, performedAt: new Date().toISOString(), values }
      }

      await service.removeValues({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
        values: arr,
      })
      return { state: 'complete' as const, performedAt: new Date().toISOString(), values: [] }
    }),

  /**
   * Set values for multiple resources (bulk operation).
   * Expects recordIds in RecordId format.
   */
  setBulk: capabilityProcedure
    .input(
      z.object({
        recordIds: z.array(z.string()).min(1), // RecordId format
        values: z.array(
          z.object({
            fieldId: fieldIdSchema,
            value: z.any().nullable(),
            /**
             * Per-item write mode. Default `'set'` — replace. Use `'add'` /
             * `'remove'` to append / delete values on multi-value fields.
             * Mixing modes across items in one call is the whole point of
             * putting `mode` here instead of at the top level.
             */
            mode: z.enum(['set', 'add', 'remove']).default('set'),
          })
        ),
        /**
         * Stage 1 AI request across the full cartesian product. Each
         * (recordId, fieldId) pair enqueues its own autofill job; the
         * bulk service fans out per-pair calls to setValueWithBuiltIn.
         */
        ai: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write enforcement (phase 4 §3.2 + plan 40 §5.5). Record hosts resolve
      // per DISTINCT def (in-memory Set lookups); thread hosts resolve per
      // INSTANCE, because the lens is per thread — one `getThreadLensBatch` for
      // the whole batch, and a partial-visibility set is rejected outright
      // rather than partially applied.
      await assertFieldValueHostsWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        hosts: input.recordIds as RecordId[],
      })

      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )

      // Bucketing + fan-out lives in FieldValueService.applyBulk so the router,
      // the app-facing set-values route, and platform writes share one path.
      return await service.applyBulk({
        recordIds: input.recordIds as RecordId[],
        values: input.values,
        ai: input.ai,
      })
    }),

  /**
   * Delete a field value for a resource.
   * Expects recordId in RecordId format.
   */
  delete: capabilityProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write enforcement (phase 4 §3.2 + plan 40 §5.5): clearing a field value
      // is a write to the host — same three-way branch as `set`.
      await assertFieldValueHostsWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        hosts: [input.recordId as RecordId],
      })

      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      await service.deleteValue({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
      })
      return { success: true }
    }),

  /**
   * Batch get values with relationship traversal support.
   * Uses RecordId format (entityDefinitionId:entityInstanceId).
   *
   * @param recordIds - Array of RecordIds (max 500)
   * @param fieldReferences - Array of FieldReferences (max 50):
   *   - ResourceFieldId: "contact:email" (direct field)
   *   - FieldPath: ["product:vendor", "vendor:name"] (relationship traversal)
   */
  batchGet: capabilityProcedure
    .input(
      z.object({
        recordIds: z.array(z.string()).max(500), // RecordId format
        fieldReferences: z.array(fieldReferenceSchema).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Read enforcement (§2.2) happens inside the service — it drops anchors
      // and traversal refs on defs the member can't view.
      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined,
        { capabilities: ctx.capabilities }
      )
      return await service.batchGetValues({
        recordIds: input.recordIds as RecordId[],
        fieldReferences: input.fieldReferences as FieldReference[],
      })
    }),

  /**
   * Add value to multi-value field (MULTI_SELECT, TAGS, etc.)
   * Expects recordId in RecordId format.
   */
  add: capabilityProcedure
    .input(
      z.object({
        recordId: z.string(), // RecordId format
        fieldId: fieldIdSchema,
        fieldType: z.string(),
        value: typedValueInputSchema,
        position: z
          .union([z.literal('start'), z.literal('end'), z.object({ after: z.string() })])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write enforcement (phase 4 §3.2 + plan 40 §5.5): appending a multi-value
      // is a write to the host — same three-way branch as `set`.
      await assertFieldValueHostsWritable({
        db: ctx.db,
        capabilities: ctx.capabilities,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        hosts: [input.recordId as RecordId],
      })

      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      return await service.addValue({
        recordId: input.recordId as RecordId,
        fieldId: input.fieldId,
        fieldType: input.fieldType,
        value: input.value as any,
        position: input.position,
      })
    }),

  /**
   * Remove value from multi-value field
   */
  remove: capabilityProcedure
    .input(z.object({ valueId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // `remove` carries only the value's id, so resolve its HOST (def + instance)
      // to enforce the write gate (phase 4 §3.2 + plan 40 §5.5). The instance is
      // load-bearing now: a thread host is gated per thread, not per def. A
      // missing row is a no-op removal — skip the gate.
      const [row] = await ctx.db
        .select({
          entityDefinitionId: schema.FieldValue.entityDefinitionId,
          entityId: schema.FieldValue.entityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.id, input.valueId),
            eq(schema.FieldValue.organizationId, ctx.session.organizationId)
          )
        )
      if (row) {
        await assertFieldValueHostsWritable({
          db: ctx.db,
          capabilities: ctx.capabilities,
          organizationId: ctx.session.organizationId,
          userId: ctx.session.user.id,
          hosts: [{ entityDefinitionId: row.entityDefinitionId, entityInstanceId: row.entityId }],
        })
      }

      const service = new FieldValueService(
        ctx.session.organizationId,
        ctx.session.user.id,
        ctx.db,
        ctx.headers.get('x-realtime-socket-id') ?? undefined
      )
      await service.removeValue(input.valueId)
      return { success: true }
    }),
})

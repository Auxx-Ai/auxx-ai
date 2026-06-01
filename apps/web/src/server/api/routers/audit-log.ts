// apps/web/src/server/api/routers/audit-log.ts
// Read + export API for the audit log. `list` powers the org-admin Account Activity
// feed; `listAll`/`exportAll` are super-admin (cross-org) for support + compliance.

import {
  AUDIT_CATEGORIES,
  AUDIT_VISIBILITIES,
  exportAuditEvents,
  listAllAuditEvents,
  listAuditEvents,
} from '@auxx/lib/audit-log'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { adminProcedure, createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'

const categoryEnum = z.enum(AUDIT_CATEGORIES as unknown as [string, ...string[]])
const visibilityEnum = z.enum(AUDIT_VISIBILITIES as unknown as [string, ...string[]])
const cursorSchema = z.object({ createdAt: z.string(), id: z.string() })

const listInput = z.object({
  category: categoryEnum.optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: cursorSchema.optional(),
})

export const auditLogRouter = createTRPCRouter({
  /** Org-scoped, customer-visible activity feed (admin/owner only). */
  list: adminProcedure.input(listInput).query(async ({ ctx, input }) => {
    const result = await listAuditEvents({
      organizationId: ctx.session.organizationId,
      category: input.category as never,
      actorId: input.actorId,
      action: input.action,
      from: input.from,
      to: input.to,
      limit: input.limit,
      cursor: input.cursor,
    })
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
    }
    return result.value
  }),

  /** Cross-org view incl. internal + platform-level rows (super-admin only). */
  listAll: superAdminProcedure
    .input(
      listInput.extend({
        organizationId: z.string().nullish(),
        visibility: visibilityEnum.optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await listAllAuditEvents({
        organizationId: input.organizationId,
        category: input.category as never,
        actorId: input.actorId,
        action: input.action,
        visibility: input.visibility as never,
        from: input.from,
        to: input.to,
        limit: input.limit,
        cursor: input.cursor,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }
      return result.value
    }),

  /** Export the current org's audit rows (admin/owner) — CSV or NDJSON. */
  export: adminProcedure
    .input(
      z.object({
        format: z.enum(['csv', 'ndjson']).optional(),
        category: categoryEnum.optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await exportAuditEvents({
        organizationId: ctx.session.organizationId,
        category: input.category as never,
        from: input.from,
        to: input.to,
        format: input.format,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      await recordAuditFromCtx(ctx, {
        category: 'data_export',
        action: 'audit.exported',
        targetType: 'AuditLog',
        metadata: {
          rowCount: result.value.count,
          format: input.format ?? 'csv',
          category: input.category ?? null,
          from: input.from?.toISOString() ?? null,
          to: input.to?.toISOString() ?? null,
        },
      })

      return result.value
    }),

  /** Cross-org export for compliance (super-admin). */
  exportAll: superAdminProcedure
    .input(
      z.object({
        format: z.enum(['csv', 'ndjson']).optional(),
        organizationId: z.string().nullish(),
        category: categoryEnum.optional(),
        visibility: visibilityEnum.optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await exportAuditEvents({
        organizationId: input.organizationId,
        category: input.category as never,
        visibility: input.visibility as never,
        from: input.from,
        to: input.to,
        format: input.format,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      await recordAuditFromCtx(ctx, {
        organizationId: input.organizationId ?? null,
        category: 'data_export',
        action: 'audit.exported_all',
        actorType: 'admin',
        visibility: 'internal',
        targetType: 'AuditLog',
        metadata: {
          rowCount: result.value.count,
          format: input.format ?? 'csv',
          scopedOrganizationId: input.organizationId ?? null,
          category: input.category ?? null,
          visibilityFilter: input.visibility ?? null,
          from: input.from?.toISOString() ?? null,
          to: input.to?.toISOString() ?? null,
        },
      })

      return result.value
    }),
})

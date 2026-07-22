// apps/web/src/server/api/routers/data-export.ts

import { conditionGroupSchema } from '@auxx/lib/conditions'
import {
  createExportJob,
  deleteExportJob,
  type ExportColumn,
  getExportJobByOrg,
  listExportJobsByOrg,
  markCanceled,
} from '@auxx/lib/export'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import type { FieldReference } from '@auxx/types/field'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** A column snapshot: label + FieldReference (direct string or path string[]). */
const exportColumnSchema = z.object({
  label: z.string(),
  fieldRef: z.union([z.string(), z.array(z.string())]),
})

/** Mirrors `PrintHeaderFooter` (`@auxx/database`/`@auxx/lib/export`) — free-text token
 * templates for one header/footer slot. */
const printHeaderFooterSchema = z.object({
  left: z.string().optional(),
  center: z.string().optional(),
  right: z.string().optional(),
})

/** Mirrors `PrintConfig` (plans/printing/01-unified-print.md §B). `list` is the only style
 * the worker implements today (P2) — `detail`/`document` are accepted here so the wizard's
 * contract doesn't need to change again in P3/P4, but the job fails them with a clear
 * not-yet-implemented error. */
const printConfigSchema = z.object({
  style: z.enum(['list', 'detail', 'document']),
  paperSize: z.enum(['a4', 'letter']),
  orientation: z.enum(['auto', 'portrait', 'landscape']),
  header: printHeaderFooterSchema.extend({ showLogo: z.boolean() }),
  footer: printHeaderFooterSchema,
  list: z.object({ fitMode: z.enum(['shrink', 'wrap']) }).optional(),
  detail: z.object({ pageBreakPerRecord: z.boolean() }).optional(),
  document: z
    .object({
      documentTypeId: z.string(),
      copies: z.array(z.enum(['customer', 'office'])),
      collation: z.enum(['per_record', 'stacks']),
      options: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})

/**
 * Data export tRPC router. Creates background CSV export / PDF print jobs driven by a table
 * view (or a frozen record selection), reports their status, and hands back presigned
 * download URLs.
 */
export const dataExportRouter = createTRPCRouter({
  /** Create an export/print job (snapshot the view or selection) and enqueue the worker. */
  create: protectedProcedure
    .input(
      z.object({
        entityDefinitionId: z.string(),
        exportType: z.enum(['view', 'all', 'selection']),
        tableId: z.string().optional(),
        viewId: z.string().optional(),
        filters: z.array(conditionGroupSchema).optional(),
        sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })).optional(),
        columns: z.array(exportColumnSchema),
        /** `'csv'` (default, existing export path) or `'pdf'` (a print run — requires
         * `printConfig`). */
        format: z.enum(['csv', 'pdf']).default('csv'),
        printConfig: printConfigSchema.optional(),
        /** `exportType: 'selection'` — the frozen, ordered id list to print/export. */
        recordIds: z.array(z.string()).max(5000).optional(),
        fileName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (input.exportType === 'selection' && (input.recordIds?.length ?? 0) === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selection scope requires at least one recordId',
        })
      }
      if (input.format === 'pdf' && !input.printConfig) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'PDF print jobs require printConfig' })
      }
      // Document-style print runs render whole per-record documents, not a column table —
      // every other combination (CSV, list/detail print) needs at least one column.
      const isDocumentStyle = input.format === 'pdf' && input.printConfig?.style === 'document'
      if (input.columns.length === 0 && !isDocumentStyle) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least one column is required' })
      }

      const columns: ExportColumn[] = input.columns.map((c) => ({
        label: c.label,
        fieldRef: c.fieldRef as FieldReference,
      }))

      const { id } = await createExportJob(ctx.db, {
        organizationId,
        userId,
        entityDefinitionId: input.entityDefinitionId,
        exportType: input.exportType,
        columns,
        tableId: input.tableId,
        viewId: input.viewId,
        filters: input.filters,
        sorting: input.sorting,
        fileName: input.fileName,
        format: input.format,
        printConfig: input.printConfig,
        recordIds: input.recordIds,
      })

      const jobName = input.format === 'pdf' ? 'printRecordsJob' : 'exportRecordsJob'
      await getQueue(Queues.dataExportQueue).add(jobName, {
        exportJobId: id,
        organizationId,
      })

      return { id }
    }),

  /** Get a single export job (status + progress counters + result metadata). */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const job = await getExportJobByOrg(ctx.db, ctx.session.organizationId, input.id)
    if (!job) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Export job not found' })
    }
    return job
  }),

  /** Recent export jobs for the org (history), optionally scoped to one entity. */
  list: protectedProcedure
    .input(z.object({ entityDefinitionId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return listExportJobsByOrg(ctx.db, ctx.session.organizationId, {
        entityDefinitionId: input?.entityDefinitionId,
      })
    }),

  /** Get a presigned download URL for a completed export. */
  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getExportJobByOrg(ctx.db, ctx.session.organizationId, input.id)
      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Export job not found' })
      }
      if (job.status !== 'completed' || !job.storageLocationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Export is not ready for download' })
      }

      const { StorageManager } = await import('@auxx/lib/files')
      const storage = new StorageManager(ctx.session.organizationId)
      const ref = await storage.getDownloadRef({
        locationId: job.storageLocationId,
        ttlSec: 3600,
        disposition: 'attachment',
        filename: job.fileName ?? `export-${job.id}.csv`,
      })
      if (ref.type !== 'url') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Download URL unavailable for this storage provider',
        })
      }
      return { url: ref.url, expiresAt: ref.expiresAt }
    }),

  /** Cancel a pending/processing export (worker stops on the next page). */
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const canceled = await markCanceled(ctx.db, ctx.session.organizationId, input.id)
      return { canceled }
    }),

  /** Delete an export job and its stored file. */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getExportJobByOrg(ctx.db, ctx.session.organizationId, input.id)
      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Export job not found' })
      }
      if (job.storageLocationId) {
        const { StorageManager } = await import('@auxx/lib/files')
        await new StorageManager(ctx.session.organizationId)
          .deleteFile(job.storageLocationId)
          .catch(() => {})
      }
      await deleteExportJob(ctx.db, ctx.session.organizationId, input.id)
      return { success: true }
    }),
})

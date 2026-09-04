// apps/web/src/server/api/routers/banking-import.ts
//
// Statement file import: parse, remember a mapping, preview what a file does to
// an account, file it, and undo it (HANDOFF slot 3D,
// plans/bank-connection/05-file-import.md, plans/accounting/ui-plan.md §2.9).
//
// Mounted as `banking.bankingImport` from `banking.ts`. It lives in its own file
// rather than inline there because three agents are editing that router in the
// same wave and a 200-line block in the middle of it is a merge conflict looking
// for somewhere to happen.
//
// 🛑 Reads are `ledgerView`; every write is `ledgerPost`. Filing a statement
// against an account decides what the books say cash did, which is a post-grade
// act even where it writes no posting - the same reasoning that puts the bank
// account's own writes on `ledgerPost`.
//
// 🛑 Nothing here re-validates what the lib already refuses. Every refusal
// reaches the browser as an `AuxxError` verbatim and renders as a card, never a
// toast (HANDOFF ground rule 9): "31 Jan, -$50.00, FUEL STOP 12 - carries
// posting gp_42" is the only sentence that says what to do next, and replacing
// it with "Could not reverse" throws that away.

import type { BankImportRow } from '@auxx/lib/banking'
import {
  finalizeBankImport,
  listImportBatches,
  previewCoverageEffect,
  readSavedMapping,
  reverseImport,
  saveMapping,
} from '@auxx/lib/banking'
import { NotFoundError, UnprocessableEntityError } from '@auxx/lib/errors'
import {
  getJobWithMapping,
  getMappablePropertiesWithSamples,
  getMappedColumnsWithStats,
  getRawDataAsArray,
  isOfxContent,
  parseOfx,
  resolveValue,
  toOfxImportRows,
} from '@auxx/lib/import'
import type { ResolutionType } from '@auxx/lib/import/client'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * The largest statement text `parseFile` will look at.
 *
 * ⚠️ Smaller than the wizard's own 20MB file cap, and deliberately: this one
 * crosses the wire as a tRPC string. Four megabytes of OFX is roughly twenty
 * thousand transactions, which is more than any month of any account this
 * product serves; a file bigger than that is a CSV export somebody renamed.
 */
const MAX_OFX_BYTES = 4_000_000

/**
 * The four `bank_transaction` fields a statement row carries, keyed by the
 * `targetFieldKey` a mapping actually stores.
 *
 * 🛑 That key is the field's **system attribute**, not the key the registry file
 * declares it under: `getFieldOutputKey` answers
 * `field.systemAttribute ?? field.key`, and the wizard's picker stores whatever
 * that returns. Matching on `amountMinor` here reads every column as unmapped,
 * which makes the preview claim the file has no date - while the import that
 * follows works fine.
 */
const ROW_FIELD_BY_ATTRIBUTE: Record<
  string,
  'externalId' | 'postedAt' | 'amountMinor' | 'description'
> = {
  bank_transaction_external_id: 'externalId',
  bank_transaction_posted_at: 'postedAt',
  bank_transaction_amount: 'amountMinor',
  bank_transaction_description: 'description',
}

export const bankingImportRouter = createTRPCRouter({
  /**
   * Parse an uploaded statement, detecting OFX/QFX/QBO by content.
   *
   * ⚠️ **Takes the file's TEXT, not a file id.** The shared importer never
   * uploads a file: `step-upload.tsx` parses the CSV in the browser and posts
   * parsed ROWS through `dataImport.uploadChunk`, so there is no stored object
   * and no id to hand over. Adding one would mean a storage round trip, a
   * `StorageLocation`, and a cleanup job for a statement we are about to turn
   * into rows anyway.
   *
   * 🛑 The parser is `@auxx/lib/import/ofx`, which is pure and also reachable
   * from the browser. This procedure exists so the SERVER is the one authority
   * that decides what a file says - and so the answer is testable without a
   * browser - not because the client could not do it.
   *
   * `ledgerView`: it reads nothing and writes nothing, but the shape of an
   * account's statements is not public.
   */
  parseFile: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        fileName: z.string().max(400).optional(),
        content: z.string().min(1).max(MAX_OFX_BYTES),
      })
    )
    .mutation(async ({ input }) => {
      if (!isOfxContent(input.content)) {
        return { isOfx: false as const }
      }

      const doc = parseOfx(input.content)
      const { headers, rows } = toOfxImportRows(doc)

      return {
        isOfx: true as const,
        form: doc.form,
        account: doc.account,
        currency: doc.currency,
        ledgerBalance: doc.ledgerBalance,
        duplicateFitIds: doc.duplicateFitIds,
        /**
         * What lets the wizard skip its mapping step: with a `FITID` on every
         * row the column mapping is not a question anybody has to answer.
         */
        hasFitIds: doc.hasFitIds,
        headers,
        rows,
        rowCount: rows.length,
      }
    }),

  /** The mapping this org last remembered for a file with this header row. */
  savedMapping: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ headers: z.array(z.string()).min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      return readSavedMapping(ctx.db, {
        organizationId: ctx.session.organizationId,
        headers: input.headers,
      })
    }),

  /**
   * Remember this file's mapping, so the next upload of the same export
   * prefills.
   *
   * `ledgerPost`: it is a settings write, and the setting decides how a future
   * statement is read into the books.
   */
  saveMapping: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        headers: z.array(z.string()).min(1).max(200),
        columns: z
          .array(
            z.object({
              columnIndex: z.number().int().nonnegative(),
              targetFieldKey: z.string().max(200).nullable(),
              resolutionType: z.string().max(100),
              isIdentifier: z.boolean().default(false),
            })
          )
          .max(200),
        label: z.string().max(200).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return saveMapping(ctx.db, {
        organizationId: ctx.session.organizationId,
        headers: input.headers,
        columns: input.columns,
        label: input.label,
      })
    }),

  /**
   * What this job's rows would do to the account's coverage, and how much of
   * them we already hold.
   *
   * The rows are read back out of the job through the SAME resolvers the
   * executor will use (`resolveValue` on the column's stored resolution type),
   * so the preview cannot disagree with the import about what a cell means -
   * which is exactly how a preview earns being believed.
   */
  coverageEffect: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ jobId: z.string().min(1), bankAccountId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await readJobRows(ctx.db, ctx.session.organizationId, input.jobId)
      const result = await previewCoverageEffect(ctx.db, {
        organizationId: ctx.session.organizationId,
        bankAccountId: input.bankAccountId,
        rows,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * File a finished import against an account: stamp the rows, link what the
   * feed already had, move the coverage floor.
   */
  finalize: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ jobId: z.string().min(1), bankAccountId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Org-scoping the job before the lib touches it: `finalizeBankImport`
      // reaches the job's plan rows through a join that is scoped by
      // organizationId, but a 404 that names the job is a better answer than an
      // empty batch.
      const job = await getJobWithMapping(ctx.db, ctx.session.organizationId, input.jobId)
      if (!job) throw new NotFoundError(`Import job ${input.jobId} was not found`)

      const result = await finalizeBankImport(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        bankAccountId: input.bankAccountId,
        importJobId: input.jobId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Undo a batch: delete the rows nobody has decided anything about, refuse the
   * rest by name.
   */
  reverse: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ importBatchId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await reverseImport(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        importBatchId: input.importBatchId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Every statement import filed against an account, newest first. */
  listBatches: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ bankAccountId: z.string().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await listImportBatches(ctx.db, {
        organizationId: ctx.session.organizationId,
        bankAccountId: input?.bankAccountId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})

/**
 * The job's raw cells, read through its own column mapping into the four fields
 * a statement line has.
 *
 * 🛑 One authority for what a cell means. `resolveValue` is the function the
 * executor calls, with the column's own stored `resolutionType` and its currency
 * precision - so a money column read as `currency:major` yields the same minor
 * units here and there. Re-parsing the text with a second rule is how a preview
 * that says "62 rows, 14 already here" and an import that writes 62 new rows
 * both look right.
 */
async function readJobRows(
  db: Parameters<typeof getJobWithMapping>[0],
  organizationId: string,
  jobId: string
): Promise<BankImportRow[]> {
  const job = await getJobWithMapping(db, organizationId, jobId)
  if (!job) throw new NotFoundError(`Import job ${jobId} was not found`)

  const properties = await getMappablePropertiesWithSamples(db, jobId, job.importMappingId)
  const stats = await getMappedColumnsWithStats(db, { jobId, organizationId })
  const statsByIndex = new Map((stats ?? []).map((column) => [column.columnIndex, column]))

  const columns = properties.flatMap((property) => {
    const key = property.targetFieldKey
      ? ROW_FIELD_BY_ATTRIBUTE[property.targetFieldKey]
      : undefined
    if (!key) return []
    const stat = statsByIndex.get(property.columnIndex)
    return [
      {
        key,
        columnIndex: property.columnIndex,
        resolutionType: property.resolutionType as ResolutionType,
        config: {
          numberDecimalSeparator: property.numberDecimalSeparator ?? undefined,
          currencyCode: stat?.currencyCode,
          decimals: stat?.decimals,
        },
      },
    ]
  })

  if (!columns.some((column) => column.key === 'postedAt')) {
    throw new UnprocessableEntityError(
      'No column is mapped to the transaction date, so this file cannot say what period it ' +
        'covers. Map a date column before filing it against an account.'
    )
  }

  const raw = await getRawDataAsArray(db, jobId)
  return raw.map((cells) => {
    const row: BankImportRow = {
      externalId: null,
      postedAt: null,
      amountMinor: null,
      description: null,
    }
    for (const column of columns) {
      const cell = cells[column.columnIndex] ?? ''
      const resolved = resolveValue(cell, column.resolutionType, column.config)
      // An error or a create is not a value: the review step is where a bad cell
      // is meant to surface, and guessing one here would make the preview
      // disagree with the run.
      if (resolved.type !== 'value' || resolved.value == null) continue

      if (column.key === 'amountMinor') {
        const amount = Number(resolved.value)
        row.amountMinor = Number.isFinite(amount) ? Math.round(amount) : null
      } else if (column.key === 'postedAt') {
        row.postedAt = String(resolved.value).slice(0, 10)
      } else {
        row[column.key] = String(resolved.value)
      }
    }
    return row
  })
}

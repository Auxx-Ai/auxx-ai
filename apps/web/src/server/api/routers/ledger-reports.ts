// apps/web/src/server/api/routers/ledger-reports.ts
//
// Statements: trial balance, balance sheet, profit and loss, completeness,
// account drill-down, the general ledger and the statement PDF
// (plans/accounting/HANDOFF.md slot 1E; aging in 2H; the general ledger is
// task 21 §5). Mounted as `ledgerReports` in `root.ts` by wave 0.
//
// Every procedure is `ledgerView` - even `renderStatementPdf`, which writes a
// file but writes nothing to the LEDGER. Zod here checks SHAPE only
// (`YYYY-MM-DD`); the lib reads throw `AuxxError` subclasses for anything an
// out-of-range or malformed bound would cause, per `docs/lib-module-guide.md`.
//
// Each read composes its lib call with the matching `toXRows` adapter, so the
// wire response always carries BOTH the typed model and `rows: StatementRow[]`
// - the shape the report grid (screen) and the PDF both render from. The general
// ledger is the exception: a summary and paged lines (108 §3.2).

import { readProviderSyncMarker } from '@auxx/lib/accounting/mirror'
import {
  AGING_COLUMNS,
  balanceSheetColumns,
  readAging,
  readBalanceSheet,
  readCompleteness,
  readGeneralLedgerCsv,
  readGeneralLedgerLines,
  readGeneralLedgerSummary,
  readProfitAndLoss,
  readTrialBalanceStatement,
  readVendor1099Summary,
  renderStatementPdf,
  TRIAL_BALANCE_COLUMNS,
  toAgingRows,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceStatementRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
} from '@auxx/lib/accounting/reports'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { calendarDaySchema } from '~/server/api/calendar-day-schema'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Every date bound on this router is this shape - the lib reads own the range validity. */
const dateKey = calendarDaySchema
/** One record's postings on `GlPostingSource`: the drawer's "Open in ledger" filter. */
const ledgerSource = z.object({ sourceKind: z.string().min(1), sourceId: z.string().min(1) })

export const ledgerReportsRouter = createTRPCRouter({
  /**
   * The trial balance as of ONE date (task 57 §5.3): balance-sheet accounts
   * cumulative, revenue and expense reset at the fiscal year, the difference in
   * a computed retained-earnings row.
   *
   * 🛑 It no longer ties to `ledger.verifyBalance` row for row - that sweep is
   * cumulative and this is not. `balanced` still holds, and THAT is the verdict
   * the strip renders. `readTrialBalance` is the cumulative primitive if you
   * want the old reading.
   */
  trialBalance: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ to: dateKey }))
    .query(async ({ ctx, input }) => {
      const result = await readTrialBalanceStatement(ctx.db, {
        organizationId: ctx.session.organizationId,
        asOf: input.to,
      })
      if (result.isErr()) throw result.error
      // `chart` is only for the adapters; the web already holds it via `useChartAccounts`.
      const { chart: _chart, ...statement } = result.value
      return {
        ...statement,
        columns: TRIAL_BALANCE_COLUMNS,
        rows: toTrialBalanceStatementRows(result.value),
      }
    }),

  /**
   * The balance sheet as of `asOf`, with the retained-earnings roll-forward
   * folded into Equity. `compareAsOf` renders a second, independent snapshot.
   */
  balanceSheet: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ asOf: dateKey, compareAsOf: dateKey.optional() }))
    .query(async ({ ctx, input }) => {
      const result = await readBalanceSheet(ctx.db, {
        organizationId: ctx.session.organizationId,
        asOf: input.asOf,
        compareAsOf: input.compareAsOf,
      })
      if (result.isErr()) throw result.error
      const { chart: _chart, ...statement } = result.value
      return {
        ...statement,
        columns: balanceSheetColumns(result.value),
        rows: toBalanceSheetRows(result.value, result.value.compare, result.value.chart),
      }
    }),

  /**
   * Profit and loss over `[from, to]`, with cost of goods sold split from
   * operating expense by the `5xxx` code-prefix presentation heuristic.
   * `compare` renders a second, independent range.
   */
  profitAndLoss: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        from: dateKey,
        to: dateKey,
        compare: z.object({ from: dateKey, to: dateKey }).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readProfitAndLoss(ctx.db, {
        organizationId: ctx.session.organizationId,
        from: input.from,
        to: input.to,
        compare: input.compare,
      })
      if (result.isErr()) throw result.error
      const { chart: _chart, ...statement } = result.value
      return {
        ...statement,
        rows: toProfitAndLossRows(result.value, result.value.compare, result.value.chart),
      }
    }),

  /**
   * What every statement's toolbar notice (`report-notices.tsx`) lists: unposted
   * periods, disabled posting types, and the two bank-feed placeholders
   * (empty until `plans/bank-connection/` ships).
   */
  completeness: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ asOf: dateKey }))
    .query(async ({ ctx, input }) => {
      const result = await readCompleteness(ctx.db, {
        organizationId: ctx.session.organizationId,
        asOf: input.asOf,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * How far the inbound provider sync has genuinely read - what every statement
   * view's toolbar notice renders (task 20 §7.3).
   *
   * Takes NO input on purpose. The reading is pure
   * (`describeProviderSyncCoverage`) and the statement's own end date lives in
   * the browser, so one input-free query serves every statement page and every
   * period the reader flips through, instead of a cache entry per as-of date.
   *
   * Answers `{ connected: false }` for an org with nothing connected, and the
   * component then renders nothing at all - the marker is meaningless there and
   * would imply a connection exists.
   */
  providerSyncMarker: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readProviderSyncMarker(ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The general ledger's accounts over `[from, to]`: opening, debit, credit and
   * ending per account, and how many lines each holds. The lines load per
   * account through `generalLedgerLines` (108 §3.2).
   */
  generalLedgerSummary: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        from: dateKey,
        to: dateKey,
        glAccountId: z.string().min(1).optional(),
        source: ledgerSource.optional(),
        search: z.string().max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readGeneralLedgerSummary(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** One page of one account's lines, each with its running balance. */
  generalLedgerLines: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        glAccountId: z.string().min(1),
        from: dateKey,
        to: dateKey,
        source: ledgerSource.optional(),
        search: z.string().max(200).optional(),
        offset: z.number().int().min(0),
        limit: z.number().int().min(1).max(500),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readGeneralLedgerLines(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The whole general ledger as CSV text, from the full read rather than the loaded rows. */
  generalLedgerCsv: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        from: dateKey,
        to: dateKey,
        glAccountId: z.string().min(1).optional(),
        source: ledgerSource.optional(),
        search: z.string().max(200).optional(),
        currencyCode: z.string().length(3).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await readGeneralLedgerCsv(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return { csv: result.value }
    }),

  /**
   * Render one statement to PDF and store it as a 24-hour `MediaAsset`
   * (`postings/reports/pdf/render-statement-pdf.ts`, modelled on
   * `documents/preview-pdf.ts`). The `StatementRow[]` payload is computed by
   * the SAME reads and adapters the screen queries above use, so the PDF can
   * never disagree with the page.
   */
  renderStatementPdf: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('trial-balance'), from: dateKey.optional(), to: dateKey }),
        z.object({
          kind: z.literal('balance-sheet'),
          asOf: dateKey,
          compareAsOf: dateKey.optional(),
        }),
        z.object({
          kind: z.literal('profit-and-loss'),
          from: dateKey,
          to: dateKey,
          compare: z.object({ from: dateKey, to: dateKey }).optional(),
        }),
        // HANDOFF slot 2H: A/R and A/P aging, and the 1099 summary (2K),
        // through the same statement PDF parts.
        z.object({ kind: z.literal('ar-aging'), asOf: dateKey }),
        z.object({ kind: z.literal('ap-aging'), asOf: dateKey }),
        z.object({ kind: z.literal('vendor-1099'), year: z.number().int() }),
        // Task 21 §5: the general ledger. Refused above `GENERAL_LEDGER_MAX_LINES` (108-D9).
        z.object({
          kind: z.literal('general-ledger'),
          from: dateKey,
          to: dateKey,
          glAccountId: z.string().min(1).optional(),
          source: ledgerSource.optional(),
        }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Narrowed per branch rather than destructuring `{ kind, ...params }`:
      // the rest spread loses the link TypeScript needs between `kind` and
      // `params`' shape, so `renderStatementPdf`'s generic can't follow it.
      if (input.kind === 'trial-balance') {
        return renderStatementPdf({
          organizationId,
          actorId: userId,
          kind: input.kind,
          // One date. `from` on the input is the carried drill-down window
          // (57 §7.1), never an input to this summary.
          params: { to: input.to },
        })
      }
      if (input.kind === 'balance-sheet') {
        return renderStatementPdf({
          organizationId,
          actorId: userId,
          kind: input.kind,
          params: { asOf: input.asOf, compareAsOf: input.compareAsOf },
        })
      }
      if (input.kind === 'profit-and-loss') {
        return renderStatementPdf({
          organizationId,
          actorId: userId,
          kind: input.kind,
          params: { from: input.from, to: input.to, compare: input.compare },
        })
      }
      if (input.kind === 'general-ledger') {
        return renderStatementPdf({
          organizationId,
          actorId: userId,
          kind: input.kind,
          params: {
            from: input.from,
            to: input.to,
            glAccountId: input.glAccountId,
            source: input.source,
          },
        })
      }
      if (input.kind === 'ar-aging' || input.kind === 'ap-aging') {
        return renderStatementPdf({
          organizationId,
          actorId: userId,
          kind: input.kind,
          params: { asOf: input.asOf },
        })
      }
      return renderStatementPdf({
        organizationId,
        actorId: userId,
        kind: input.kind,
        params: { year: input.year },
      })
    }),

  /**
   * The 1099 summary (HANDOFF slot 2K): eligible vendors whose `vendor_payment`
   * movements for `year` meet the $600 IRS threshold, grouped by box. NOT a GL
   * read - it sums `MoneyTransaction` rows and hydrates `company`. Reports zero
   * rows (never an error) on an org with no 1099 fields.
   */
  vendor1099: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const result = await readVendor1099Summary(ctx.db, {
        organizationId: ctx.session.organizationId,
        year: input.year,
      })
      if (result.isErr()) throw result.error
      return {
        ...result.value,
        columns: VENDOR_1099_COLUMNS,
        rows: toVendor1099Rows(result.value),
      }
    }),

  /**
   * A/R or A/P aging, from the GL (HANDOFF slot 2H, task 05). Open
   * `accounts_receivable`/`accounts_payable` lines grouped by the document
   * their `sourceType`/`sourceId` names, bucketed on DUE DATE (never issue
   * date), and asserted against `trialBalance`'s own figure for the same
   * role and date - `verdict` is `false` and `differenceMinor` non-zero,
   * shown rather than hidden, exactly when the two disagree.
   */
  aging: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ side: z.enum(['receivable', 'payable']), asOf: dateKey }))
    .query(async ({ ctx, input }) => {
      const result = await readAging(ctx.db, {
        organizationId: ctx.session.organizationId,
        side: input.side,
        asOf: input.asOf,
      })
      if (result.isErr()) throw result.error
      return {
        ...result.value,
        columns: AGING_COLUMNS,
        rows: toAgingRows(result.value),
      }
    }),
})

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
// - the shape `StatementTable` (screen) and the PDF both render from.

import { PermissionKey } from '@auxx/lib/permissions'
import {
  AGING_COLUMNS,
  balanceSheetColumns,
  GENERAL_LEDGER_COLUMNS,
  GENERAL_LEDGER_MAX_LINES,
  readAccountLines,
  readAging,
  readBalanceSheet,
  readCompleteness,
  readGeneralLedger,
  readProfitAndLoss,
  readProviderSyncMarker,
  readTrialBalance,
  readVendor1099Summary,
  renderStatementPdf,
  TRIAL_BALANCE_COLUMNS,
  toAgingRows,
  toBalanceSheetRows,
  toGeneralLedgerRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
} from '@auxx/lib/postings'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/** `YYYY-MM-DD`. Every date bound on this router is this shape - the lib reads own the range validity. */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const ledgerReportsRouter = createTRPCRouter({
  /**
   * The trial balance, as of `to` (activity-only from `from` when given). Ties
   * to `ledger.verifyBalance` for the same organization - see
   * `postings/reports/__tests__/trial-balance.test.ts`.
   */
  trialBalance: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ from: dateKey.optional(), to: dateKey }))
    .query(async ({ ctx, input }) => {
      const result = await readTrialBalance(ctx.db, {
        organizationId: ctx.session.organizationId,
        from: input.from,
        to: input.to,
      })
      if (result.isErr()) throw result.error
      return {
        ...result.value,
        columns: TRIAL_BALANCE_COLUMNS,
        rows: toTrialBalanceRows(result.value),
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
      return {
        ...result.value,
        columns: balanceSheetColumns(result.value),
        rows: toBalanceSheetRows(result.value, result.value.compare),
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
      return {
        ...result.value,
        rows: toProfitAndLossRows(result.value, result.value.compare),
      }
    }),

  /**
   * What every statement view's `CompletenessBanner` renders: unposted
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
   * view's `ProviderSyncMarker` renders (task 20 §7.3).
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
   * The drill-down behind one account - every posted line in the range,
   * oldest first, with a running natural-sign balance. What a row click on
   * any statement opens. Keyed on `glAccountId` (task 15), not a code, so a
   * renumbered account's history still opens as one drill-down.
   */
  accountLines: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        glAccountId: z.string().min(1),
        from: dateKey.optional(),
        to: dateKey.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await readAccountLines(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
        from: input.from,
        to: input.to,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The general ledger over `[from, to]`: every posted line, grouped by
   * account, with each account's brought-forward opening balance and a running
   * natural-sign balance. The report a filing accountant asks for FIRST, and
   * until now the only one that existed in no form at all.
   *
   * 🛑 **`truncated` is load-bearing.** Unlike every other statement on this
   * router - all of which are bounded by the CHART - this one is bounded by
   * TRANSACTION VOLUME, so it is read under a server-side line cap. The cap is
   * deliberately NOT an input: a limit the caller chooses is not a limit. When
   * it fires, `truncated` comes back `true`, `maxLines` says where it stopped,
   * and `rows[0]` is an INCOMPLETE banner that survives into the CSV and the
   * PDF. A truncated ledger does not tie to `trialBalance` for the same range,
   * and `balanced` must not be read as a tie-out unless `truncated` is false.
   */
  generalLedger: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ from: dateKey, to: dateKey }))
    .query(async ({ ctx, input }) => {
      const result = await readGeneralLedger(ctx.db, {
        organizationId: ctx.session.organizationId,
        from: input.from,
        to: input.to,
        maxLines: GENERAL_LEDGER_MAX_LINES,
      })
      if (result.isErr()) throw result.error
      return {
        ...result.value,
        maxLines: GENERAL_LEDGER_MAX_LINES,
        columns: GENERAL_LEDGER_COLUMNS,
        rows: toGeneralLedgerRows(result.value),
      }
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
        // Task 21 §5: the general ledger, under the same server-side line cap
        // the `generalLedger` query above applies - so the printed copy and the
        // page stop in the same place.
        z.object({ kind: z.literal('general-ledger'), from: dateKey, to: dateKey }),
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
          params: { from: input.from, to: input.to },
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
          params: { from: input.from, to: input.to },
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
   * The 1099 summary (HANDOFF slot 2K): eligible vendors whose posted
   * `vendor_payment` total for `year` meets the $600 IRS threshold, grouped by
   * box. NOT a GL read - `vendor_payment` ships inert, so this reads the
   * `vendor_payment`/`company` EntityInstances directly. Reports zero rows
   * (never an error) on an org that predates the entity or its 1099 fields.
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

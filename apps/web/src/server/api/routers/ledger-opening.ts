// apps/web/src/server/api/routers/ledger-opening.ts
//
// The opening trial balance: draft get/save on the `journal_entry` record of
// kind `opening_balance`, and post on finalize (plans/accounting/HANDOFF.md
// slot 1C). Mounted as `ledgerOpening` in `root.ts` by wave 0.
//
// 🛑 Every refusal in here reaches the browser as an `AuxxError` and is
// rendered as an `EntryBlockers` card, never a toast (ground rule 9). The lib
// throws `ConflictError` / `UnprocessableEntityError`; `auxxErrorMiddleware`
// maps them, and the wizard's Finalize page shows the verbatim message.

import { PermissionKey } from '@auxx/lib/permissions'
import {
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  readOpeningTrialBalance,
  saveOpeningTrialBalance,
} from '@auxx/lib/postings'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * One row of the trial balance, in the shape slot 1A froze for
 * `journalEntry.*` (HANDOFF §5a).
 *
 * Deliberately thin on the money rules. `amountMinor` is a plain number rather
 * than `z.number().int().positive()` because `buildOpeningBalanceEntry` already
 * refuses a non-integer, a negative and a zero and NAMES THE ROW while doing
 * it. Restating those three rules here would give the same input two
 * authorities, and the worse one would win: a Zod issue reads
 * `lines.7.amountMinor: expected int`, where the builder says which account the
 * row belongs to.
 */
const openingLine = z.object({
  accountCode: z.string().min(1),
  direction: z.enum(['debit', 'credit']),
  /** Integer minor units, > 0. `direction` is the only carrier of sign. */
  amountMinor: z.number(),
  memo: z.string().max(1000).optional(),
})

export const ledgerOpeningRouter = createTRPCRouter({
  /**
   * The draft (or the posted entry), the whole chart in statement order, the
   * cutover date, and the verdict - in ONE read.
   *
   * The grid is over every account in the chart, so the accounts come back with
   * the amounts rather than from a second `ledger.chartAccounts` call: a screen
   * that fetched them separately would render a chart with no amounts and then
   * a verdict that flickers into place.
   */
  get: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readOpeningTrialBalance(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Create or replace the draft.
   *
   * `lines` is wholesale, never a patch: a trial balance's rows have no
   * identity, and a row somebody CLEARED has to be able to disappear.
   *
   * 🛑 Refused once the ledger holds a standing entry, through
   * `assertAccountingSetupUnfrozen` - the same server guard `setting.update`
   * and `setting.batchUpdate` run over `accounting.opening*`. The opening trial
   * balance is the same baseline as those three scalars, and a freeze with a
   * door in it is not a freeze. `updateJournalEntry` refuses a posted record on
   * top of that, so a finalized setup is covered twice over.
   */
  save: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        lines: z.array(openingLine).max(500),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await saveOpeningTrialBalance(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * What the opening entry WOULD post. Persists nothing, including `lines`.
   *
   * A `.mutation()` despite writing nothing, for `ledger.preview`'s two
   * reasons: the lines are a request BODY that does not fit in a URL, and a
   * preview keyed on the whole grid is not cacheable in any useful sense.
   */
  preview: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z
        .object({
          lines: z.array(openingLine).max(500).optional(),
          memo: z.string().max(4000).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await previewOpeningTrialBalance(
        ctx.db,
        ctx.session.organizationId,
        input ?? {}
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Post the opening entry. This is what the wizard's Finalize calls, after the
   * settings finalize has landed.
   *
   * Returns a `PostResult` verbatim rather than throwing on a refusal: a closed
   * period, an account that has left the chart and a provider that said no are
   * all statuses the done page RENDERS as an `EntryBlockers` card. Flattening
   * them into an error would throw away `docNumber`, `failureClass` and
   * `retryable` - the whole of what says what to do next.
   */
  post: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ memo: z.string().max(4000).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await postOpeningTrialBalance(ctx.db, organizationId, userId, input ?? {})
      if (result.isErr()) throw result.error
      return result.value
    }),
})

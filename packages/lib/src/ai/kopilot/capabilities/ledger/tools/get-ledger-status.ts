// packages/lib/src/ai/kopilot/capabilities/ledger/tools/get-ledger-status.ts

import { readMonthActivity } from '../../../../../accounting/ledger/periods/month-activity'
import { findDuplicateBankMovements } from '../../../../../accounting/ledger/post/duplicate-movements'
import { verifyBooksBalance } from '../../../../../accounting/ledger/post/verify-balance'
import { readRailFeeStatus } from '../../../../../accounting/rails/rail-fee-status'
import { PermissionKey } from '../../../../../permissions/capabilities/registry'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/** `'2026-09'`. The same shape the ledger router's `monthKey` input accepts. */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Everything the ledger console used to render as standing chrome in its module
 * rail, as one read the model can ask for instead.
 *
 * ## Why this tool exists
 *
 * The rail carried four groups of live data - the balance sweep and its
 * duplicate findings (`BooksGroup`), processor fee treatment per rail
 * (`RailFeesGroup`) and what posted this month (`ThisMonthGroup`) - none of
 * which is an action. Four blocks of numbers nobody clicks is what makes a rail
 * stop being read; the rail is now two nav items (Closeout, Sync queue) and
 * this is where the numbers went. Kopilot is on the page, it can be asked, and
 * an answer that arrives because somebody wanted it beats one that is always
 * on screen and never looked at.
 *
 * ## The month
 *
 * `periodKey` is OPTIONAL and the two halves genuinely differ:
 *
 * - **Balance and duplicates are WHOLE-LEDGER facts.** They are answered with
 *   or without a month; a month only narrows the duplicate scan and adds the
 *   completeness counts (what the month still owes the books).
 * - **Processor fees and month activity are about ONE month.** Without one
 *   there is no question to put, so they come back `null` rather than as an
 *   empty list - `null` is "not asked", never "nothing there".
 *
 * 🛑 The page does NOT bind the month for the model. `SessionContext` carries a
 * `page` plus typed entity refs, and an accounting period is neither; inventing
 * a ref kind for it would be a second context mechanism for one screen. The
 * model passes the month the user is talking about, or omits it.
 *
 * ⚠️ **A fact, never an alarm.** Every source read here was built to state a
 * count and a date and let the reader draw the conclusion - a rail that bills
 * quarterly is not a refusal, and "0 discrepancies out of 412" is the ordinary
 * reading of healthy books. Nothing here blocks a close and nothing here is
 * evidence that anything is wrong on its own.
 */
export function createGetLedgerStatusTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_ledger_status',
    permission: {
      target: 'area',
      area: 'ledger',
      level: 'view',
      enforcement: 'enforced',
      note: 'PermissionKey.ledgerView on the caller’s own CapabilityView — exact parity with the four ledger router procedures this wraps, every one of which is permissionProcedure(ledgerView). Absent capabilities ⇒ unrestricted, the documented lib-wide convention; this is a read, so it follows it rather than failing closed the way the graph-WRITE guards do.',
    },
    displayName: 'Read ledger status',
    category: 'capability',
    idempotent: true,
    description:
      'Read the accounting ledger’s standing status: whether the books balance, any duplicate bank movements found, how each payment rail’s processor fees are treated, and what posted in a given month. Read-only — it posts nothing, closes nothing and changes no books. Pass `periodKey` as the month the user is looking at ("YYYY-MM") whenever the question is about a month; omit it for a whole-ledger balance check.',
    usageNotes:
      '`books.balanced` plus `books.postingsChecked` is the whole balance answer — "0 discrepancies out of 0 checked" and "0 out of 412" are different answers, so always quote the count. `processorFees` and `monthActivity` are `null` when no `periodKey` was passed: that is "not asked", never "nothing there", so do not report it as an empty result. Same rule for the `null` counts inside `books` and `monthActivity`. A rail whose `feeTreatment` is `billed` and that has not booked a fee lately is a FACT, not a problem — some rails bill quarterly; report the date and let the user judge.',
    parameters: {
      type: 'object',
      properties: {
        periodKey: {
          type: 'string',
          description:
            'Accounting month as "YYYY-MM" (e.g. "2026-09"). Omit for a whole-ledger balance check with no month-specific figures.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities } = getDeps()

      // Human parity: every procedure this wraps is
      // `permissionProcedure(PermissionKey.ledgerView)`. Absent capabilities ⇒
      // unrestricted, the documented lib-wide convention for reads.
      if (capabilities && !capabilities.can(PermissionKey.ledgerView)) {
        return {
          success: false,
          output: null,
          error: 'You don’t have permission to read the general ledger.',
        }
      }

      const raw = (args as { periodKey?: unknown }).periodKey
      const periodKey = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
      if (periodKey !== undefined && !MONTH_RE.test(periodKey)) {
        return {
          success: false,
          output: null,
          error: `"${periodKey}" is not an accounting month. Use "YYYY-MM", e.g. "2026-09".`,
        }
      }

      const organizationId = agentDeps.organizationId

      const [balance, duplicates] = await Promise.all([
        verifyBooksBalance(db, organizationId, { month: periodKey }),
        findDuplicateBankMovements(db, { organizationId, month: periodKey }),
      ])
      if (balance.isErr()) {
        return { success: false, output: null, error: balance.error.message }
      }
      if (duplicates.isErr()) {
        return { success: false, output: null, error: duplicates.error.message }
      }

      // Both are questions ABOUT a month. With none resolved they are not asked,
      // and `null` says so - an empty array would claim "no rails" / "nothing
      // posted", which is a claim nobody checked.
      let processorFees = null
      let monthActivity = null
      if (periodKey) {
        const [rails, activity] = await Promise.all([
          readRailFeeStatus(db, { organizationId, month: periodKey }),
          readMonthActivity(db, { organizationId, month: periodKey }),
        ])
        if (rails.isErr()) {
          return { success: false, output: null, error: rails.error.message }
        }
        if (activity.isErr()) {
          return { success: false, output: null, error: activity.error.message }
        }
        processorFees = rails.value
        monthActivity = activity.value
      }

      const report = balance.value
      const summary = periodKey
        ? `${periodKey}: ${report.discrepancies.length} discrepancies out of ${report.postingsChecked} postings checked, ${duplicates.value.length} duplicate bank movements, ${processorFees?.length ?? 0} active payment rails.`
        : `Whole ledger: ${report.discrepancies.length} discrepancies out of ${report.postingsChecked} postings checked, ${duplicates.value.length} duplicate bank movements. No month asked, so nothing month-specific was read.`

      return {
        success: true,
        output: {
          summary,
          month: periodKey ?? null,
          books: report,
          duplicateMovements: duplicates.value,
          processorFees,
          monthActivity,
        },
      }
    },
  }
}

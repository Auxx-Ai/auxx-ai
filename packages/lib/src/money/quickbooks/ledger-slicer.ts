// packages/lib/src/money/quickbooks/ledger-slicer.ts
//
// QuickBooks' `ProviderLedgerSlicer`: a RANGED walk, one calendar month per
// batch (brief 55 §4.9).
//
// **Why a month.** Intuit's report endpoint accepts `startposition` and
// `maxresults` and silently ignores them, so the date range is the only lever
// there is - and 🛑 a truncated chunk is indistinguishable from a quiet month.
// Chunk size is a safety property, not a performance knob. Xero's Journals feed
// has no date range at all and will slice by `JournalNumber`; that difference is
// the whole reason this seam exists.
//
// 🛑 `assertRangeEcho` is QuickBooks-side and stays here: it exists because
// Intuit silently ignores some date parameters, and Xero will have no range to
// echo.

import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type {
  ProviderLedger,
  ProviderLedgerBatch,
  ProviderLedgerSlicer,
  ProviderSyncRange,
} from '../../postings/provider-sync/client'
import { monthChunk, nextDay } from '../../postings/provider-sync/range'
import type { SyncCursor } from '../../sync-core/contracts'
import { resolveQuickbooksContext } from './invoke-quickbooks-tool'

/** Brief 20 §5.1: the inbound half's one report read. */
const TOOL_GET_GENERAL_LEDGER = 'get_quickbooks_general_ledger'

/**
 * `${monthStart}..${rangeEnd}` - the month to read, and where the planned walk
 * ends.
 *
 * 🛑 The range end rides ON the cursor rather than in the slicer, because the
 * cursor is the ONLY thing the core persists between slices. A slicer that held
 * the range as instance state would lose it when a worker restart rebuilds the
 * source from the state blob, and the resumed chain would not know when to stop.
 * The core never interprets `value`, so a compound one costs nothing above here.
 */
const CURSOR_SEPARATOR = '..'

function encodeCursor(monthStart: string, rangeEnd: string): SyncCursor {
  return { kind: 'token', value: `${monthStart}${CURSOR_SEPARATOR}${rangeEnd}` }
}

function decodeCursor(cursor: SyncCursor): { monthStart: string; rangeEnd: string } {
  const [monthStart, rangeEnd] = cursor.value.split(CURSOR_SEPARATOR)
  if (!monthStart || !rangeEnd) {
    throw new UnprocessableEntityError(
      `"${cursor.value}" is not a QuickBooks ledger cursor. It must be "<month start>..<range end>".`,
      { cursor: cursor.value }
    )
  }
  return { monthStart, rangeEnd }
}

/**
 * 🛑 The range the provider ECHOED must be the range we asked for.
 *
 * §4.6 verified that `/reports/GeneralLedger` honours `start_date` and
 * `end_date` exactly - unlike `BalanceSheet`, where `as_of` is silently ignored
 * and `end_date` alone falls back to "this calendar year-to-date". The
 * assertion is one line and the failure it catches is severe in both
 * directions: a NARROWER echo means the next chunk starts after a period
 * nothing read, leaving a silent hole in the ledger, and a WIDER one means
 * §5.3's `'missing'` test is applied over dates this call did not really cover.
 *
 * 🛑 It THROWS rather than returning `err`, and the difference is load-bearing:
 * `err` is the transient-fault channel the source maps to `partial-retriable`,
 * which HOLDS the cursor and re-asks. A provider that relabels a range will
 * relabel it again, so a retriable echo mismatch is an infinite chain. This
 * stops the run.
 */
function assertRangeEcho(requested: ProviderSyncRange, ledger: ProviderLedger): void {
  if (ledger.from === requested.from && ledger.to === requested.to) return
  throw new UnprocessableEntityError(
    `The accounting provider was asked for ${requested.from}..${requested.to} and answered for ` +
      `${ledger.from}..${ledger.to}. A chunk labelled with a range it does not cover would leave ` +
      'a hole in the ledger that nothing downstream can see.',
    { requestedFrom: requested.from, requestedTo: requested.to, from: ledger.from, to: ledger.to }
  )
}

class QuickbooksLedgerSlicer implements ProviderLedgerSlicer {
  readonly kind = 'ranged' as const

  firstCursor(range: ProviderSyncRange): SyncCursor {
    return encodeCursor(range.from, range.to)
  }

  async fetchBatch(
    orgId: string,
    cursor: SyncCursor
  ): Promise<Result<ProviderLedgerBatch | null, Error>> {
    const { monthStart, rangeEnd } = decodeCursor(cursor)
    const chunk = monthChunk(monthStart, rangeEnd)
    if (!chunk) {
      return err(
        new UnprocessableEntityError(
          `The QuickBooks ledger walk was resumed at ${monthStart}, which is past the end of its ` +
            `range (${rangeEnd}).`,
          { organizationId: orgId, monthStart, rangeEnd }
        )
      )
    }

    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok(null)

    let ledger: ProviderLedger
    try {
      // The tool has already done every part of this that is QuickBooks' and
      // not ours: it carried each `Section` header's account id down the
      // recursion, lifted the transaction id off `ColData[1]`, asked for
      // `debt_amt` / `credit_amt` rather than the natural-direction
      // `subt_nat_amount`, and parsed money into integer minor units.
      //
      // `Accrual` is stated rather than defaulted: our own books are accrual,
      // and a cash-basis read compared against them would disagree everywhere
      // for a reason that has nothing to do with either side being wrong.
      ledger = (await resolved.context.callTool(TOOL_GET_GENERAL_LEDGER, {
        from: chunk.from,
        to: chunk.to,
        accountingMethod: 'Accrual',
      })) as ProviderLedger
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks general ledger for ${chunk.from}..${chunk.to}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          { organizationId: orgId, from: chunk.from, to: chunk.to }
        )
      )
    }

    // Outside the `catch` on purpose - see the docblock.
    assertRangeEcho(chunk, ledger)

    const hasMore = chunk.to < rangeEnd
    return ok({
      ledger,
      hasMore,
      nextCursor: hasMore ? encodeCursor(nextDay(chunk.to), rangeEnd) : undefined,
    })
  }
}

/** The one QuickBooks slicer. Stateless, so one instance serves every org. */
export const QUICKBOOKS_LEDGER_SLICER: ProviderLedgerSlicer = new QuickbooksLedgerSlicer()

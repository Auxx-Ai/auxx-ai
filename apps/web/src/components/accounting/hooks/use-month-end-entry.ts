// apps/web/src/components/accounting/hooks/use-month-end-entry.ts

'use client'

import type {
  AccountRole,
  ClosePeriod,
  PostingAssertions,
  ResolvedPostingLine,
} from '@auxx/lib/postings/client'
import { NON_FAILURE_REFUSALS } from '@auxx/lib/postings/client'
import type { LedgerEntryActions } from '~/components/accounting/hooks/use-ledger-entry-actions'
import type { LedgerBlocker } from '~/components/accounting/ui/ledger/entry-blockers'
import { journalLinesFromDetail } from '~/components/accounting/ui/ledger/entry-journal'
import {
  type RevisionEntry,
  revisionEntryFromDetail,
} from '~/components/accounting/ui/ledger/revision-strip'
import { readStoredAssertions } from '~/components/accounting/ui/ledger/stored-draft'
import { api } from '~/trpc/react'

interface UseMonthEndEntryOptions {
  activePeriod: ClosePeriod | undefined
  activePeriodKey: string
  /** `state !== 'open'` - a LOCKED month takes this branch too. */
  isPostedPeriod: boolean
  isLocked: boolean
  actions: LedgerEntryActions
}

export interface MonthEndEntry {
  /** The month's stored posting, or `null` when it has never been posted. */
  postedPostingId: string | null
  /** The projected entry for an open month, the STORED one for a posted month. */
  lines: ResolvedPostingLine[]
  docNumber: string | null | undefined
  /** Sum of the debit legs, or `null` when no entry was built. */
  totalMinor: number | null
  /** What the roll-forward renders, or `null` when there is nothing to render. */
  assertions: PostingAssertions | null
  isLoading: boolean
  blockers: LedgerBlocker[]
  /** Every blocker is an ordinary outcome rather than a fault. */
  isSoftRefusal: boolean
  canPost: boolean
  /** The reversal chain, newest revision first. */
  revisionEntries: RevisionEntry[]
  accountByRole: Partial<Record<AccountRole, { code: string | null; name: string }>>
}

/**
 * Everything about THE month-end entry: which one it is, what it says, and
 * whether it can be posted.
 *
 * 🛑 An OPEN month reads the PROJECTED entry off `previewMonthEnd`; a POSTED
 * month reads the STORED one off `ledger.get`. They are never crossed. Re-running
 * the builder over a posted month gives a different answer the moment the
 * subledger moves, and the number that matters is the one that was posted. Every
 * field below forks on `isPostedPeriod` for that reason, which is exactly why
 * they belong in one place rather than scattered down a component body.
 */
export function useMonthEndEntry({
  activePeriod,
  activePeriodKey,
  isPostedPeriod,
  isLocked,
  actions,
}: UseMonthEndEntryOptions): MonthEndEntry {
  // The stored entry for a posted month - lines, provider result and the frozen
  // assertions the roll-forward renders.
  const postedPostingId = activePeriod?.glPostingId ?? null
  const postedQuery = api.ledger.get.useQuery(
    { id: postedPostingId ?? '' },
    { enabled: !!postedPostingId }
  )
  const postedDetail = postedQuery.data

  // The one link the chain can be walked back along: a reversal names what it
  // reverses. See `RevisionStrip`'s header for why that is not the whole chain.
  const reversedQuery = api.ledger.get.useQuery(
    { id: postedDetail?.reversesId ?? '' },
    { enabled: !!postedDetail?.reversesId }
  )

  const roleMapQuery = api.ledger.roleMap.useQuery()

  const accountByRole: Partial<Record<AccountRole, { code: string | null; name: string }>> = {}
  for (const row of roleMapQuery.data ?? []) {
    if (row.account)
      accountByRole[row.role as AccountRole] = { code: row.account.code, name: row.account.name }
  }

  const revisionEntries = [postedDetail, reversedQuery.data]
    .filter((detail) => !!detail)
    .map(revisionEntryFromDetail)
    .sort((a, b) => b.revision - a.revision)

  const blockers: LedgerBlocker[] = actions.preview?.blockedBy ? [actions.preview.blockedBy] : []
  // 🛑 `nothing_to_close` and `setup_incomplete` are refusals, not faults. The
  // section around them says so too: "cannot be closed yet" over an empty month
  // is an alarm about the most ordinary thing that happens to a set of books.
  const isSoftRefusal = blockers.every((blocker) =>
    (NON_FAILURE_REFUSALS as readonly string[]).includes(blocker.status)
  )

  const lines = isPostedPeriod
    ? postedDetail
      ? journalLinesFromDetail(postedDetail.lines)
      : []
    : (actions.preview?.lines ?? [])

  /**
   * 🛑 `null` when there are no lines, NOT zero. A refused month builds no entry
   * at all and "$0.00" is a claim that it balanced to nothing, which is a
   * different and much more alarming thing than "it was never built".
   */
  const totalMinor = lines.length
    ? lines.reduce((sum, line) => (line.direction === 'debit' ? sum + line.amount : sum), 0)
    : null

  /**
   * 🛑 A POSTED month reads the STORED assertions, never a re-derivation.
   * `reverseEntry` writes the reversal's envelope with the pair ALREADY swapped,
   * so reading it back verbatim is the only way a reversed month renders as
   * reversed. Re-deriving here would quietly undo the reversal on screen.
   *
   * An OPEN month reads them off the preview, which carries the same
   * `assertions` object `postMonthEnd` hands the poster - not a second
   * derivation, so what you check before posting is what gets posted.
   */
  const assertions = isPostedPeriod
    ? postedDetail
      ? readStoredAssertions(postedDetail.draft)
      : null
    : (actions.preview?.assertions ?? null)

  /**
   * 🛑 `isPostedPeriod` is `state !== 'open'`, so a LOCKED month takes this
   * branch too - and a locked month that was never posted carries no
   * `glPostingId`, which leaves `postedQuery` disabled. A disabled query sits at
   * `status: 'pending'` forever, so reading `isPending` alone pinned the entry
   * to a skeleton that never resolved for every locked, never-posted month.
   * `lines` already falls back to `[]` on this path; the entry renders empty,
   * which is the truth about a month with no entry.
   */
  const isLoading = isPostedPeriod
    ? !!postedPostingId && postedQuery.isPending
    : actions.isPreviewing

  const canPost =
    !isPostedPeriod &&
    !isLocked &&
    blockers.length === 0 &&
    !actions.justPosted &&
    !!activePeriodKey

  return {
    postedPostingId,
    lines,
    docNumber: isPostedPeriod ? activePeriod?.docNumber : actions.preview?.docNumber,
    totalMinor,
    assertions,
    isLoading,
    blockers,
    isSoftRefusal,
    canPost,
    revisionEntries,
    accountByRole,
  }
}

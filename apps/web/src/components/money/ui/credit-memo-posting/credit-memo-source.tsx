// apps/web/src/components/money/ui/credit-memo-posting/credit-memo-source.tsx
'use client'

// The bulk credit memo posting as a REGISTRATION on the shared batch-posting
// dialog (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §5.2,
// §5.5).
//
// The second source, and the one the frame was extracted for. Everything in this
// file is one of the two things §5.5 says may differ per source: the plan table's
// COLUMNS and the footer's NOUNS. The frequency select, the range control, the
// refusal card, the exclusions table, the footer layout, the result page and the
// gateway-name lookup all live in `batch-posting/`.
//
// ## The nouns are memos and contacts
//
// Not shipments and orders. The A/R leg of a credit memo entry is one line per
// CONTACT (§3.1 item 2, aging has to name the debtor), which is why the footer
// counts contacts rather than the orders the memos came from.
//
// ## The range is on ISSUE date
//
// A credit memo credits the books on the day it was issued, so the window is on
// `issuedAt` and never on the order's date or the refund's. Both ends are
// inclusive on the screen and half-open on the wire (25 §6.1).

import type {
  CreditMemoPostingExclusion,
  CreditMemoPostingExclusionReason,
  CreditMemoPostingPlan,
  CreditMemoPostingRunSummary,
} from '@auxx/lib/money/client'
import { BATCH_POSTING_GROUPINGS } from '@auxx/lib/money/client'
import { keepPreviousData } from '@tanstack/react-query'
import type {
  BatchPostingPreview,
  BatchPostingPreviewInput,
  BatchPostingRunner,
  BatchPostingSource,
} from '~/components/money/ui/batch-posting'
import { api } from '~/trpc/react'
import { CreditMemoPlanTable } from './credit-memo-plan-table'

/**
 * What each exclusion reason says on the row.
 *
 * The `detail` here is the RULE; the exclusion's own `detail` beside it is the
 * evidence. Both are needed: "before the accounting cutoff" explains nothing
 * without the cutoff, and `2026-06` explains nothing on its own.
 *
 * 🛑 A total `Record` over the closed union, so a seventh reason stops THIS file
 * compiling rather than rendering as a raw slug in the shared table.
 *
 * ⚠️ `gateway-ambiguous` and `test-gateway` are deliberately absent, and the
 * asymmetry with the fulfillment poster is load-bearing (§7): a sale can be
 * refused and re-run, a refund cannot, because the money has already moved.
 */
const EXCLUSION_COPY: Record<CreditMemoPostingExclusionReason, { label: string; detail: string }> =
  {
    'before-cutoff': {
      label: 'Before the accounting cutoff',
      detail: 'It was issued in a period the books were opened after.',
    },
    'locked-period': {
      label: 'Locked period',
      detail: 'Its month is closed, and a closed month does not take new entries.',
    },
    'foreign-currency': {
      label: 'Foreign currency',
      detail: 'The order it credits is not in the currency the books are kept in.',
    },
    'missing-contact': {
      label: 'No customer on the memo',
      detail:
        'What is not refunded is credited to that customer in accounts receivable, and a receivable line that names nobody cannot be exported. Put the customer on the memo and it posts with the next run.',
    },
    'not-issued': {
      label: 'Not issued',
      detail:
        'A draft or voided memo is not a document the ledger has an opinion about. Issue it and it joins the next run.',
    },
    'zero-value': {
      label: 'Nothing to credit',
      detail: 'The memo moves neither revenue nor money, so there is no entry to make.',
    },
  }

/**
 * The preview query.
 *
 * 🛑 A HOOK, called unconditionally by `BatchPostingDialog` because the
 * descriptor below is a module constant. `placeholderData: keepPreviousData` is
 * not a nicety: without it every frequency change blanks the table, the excluded
 * block and the footer together, which reads as "the numbers just went away" on
 * the one screen whose whole point is watching those numbers move.
 */
function useCreditMemoPreview({
  range,
  grouping,
  enabled,
}: BatchPostingPreviewInput): BatchPostingPreview<CreditMemoPostingPlan> {
  const query = api.money.previewCreditMemoPosting.useQuery(
    { from: range?.from ?? '', to: range?.to ?? '', grouping },
    {
      enabled: enabled && !!range,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    }
  )

  return {
    plan: query.data?.plan ?? null,
    refusal: query.data?.refusal ?? null,
    errorMessage: query.error?.message ?? null,
    isPending: query.isPending,
    isFetching: query.isFetching,
  }
}

/** The run mutation, plus the caches only this source's run invalidates. */
function useCreditMemoRunner(): BatchPostingRunner<CreditMemoPostingRunSummary> {
  const utils = api.useUtils()
  const postCreditMemos = api.money.runCreditMemoPosting.useMutation()

  return {
    isPending: postCreditMemos.isPending,
    run: async ({ range, grouping }) => {
      const summary = await postCreditMemos.mutateAsync({
        from: range.from,
        to: range.to,
        grouping,
      })
      // The run writes `GlPosting` rows and stamps every memo behind them, and
      // nothing on the ledger page or a memo's ledger card learns about either on
      // its own.
      await Promise.all([
        utils.ledger.invalidate(),
        utils.money.creditMemoPostings.invalidate(),
        utils.money.previewCreditMemoPosting.invalidate(),
      ])
      return summary
    },
  }
}

export const CREDIT_MEMO_POSTING_SOURCE: BatchPostingSource<
  CreditMemoPostingPlan,
  CreditMemoPostingRunSummary,
  CreditMemoPostingExclusion
> = {
  sourceKey: 'credit_memo',
  title: 'Post credit memos',
  description: 'Book the contra revenue for every issued credit memo that has no entry yet.',
  groupings: BATCH_POSTING_GROUPINGS,
  // 🛑 `month`, where the fulfillment poster defaults to `day`. Returns are a
  // fraction of sales and they reconcile to nothing daily, so the entry a month
  // of them is worth is one `AUXX-CRM-YYYYMM` (§10 item 1). Per day is still one
  // click away when a live month wants it.
  defaultGrouping: 'month',
  groupingDescription: 'How many credit memos one entry summarises',
  rangeDescription: 'On the date the memo was issued, not the date the order was placed',
  errorTitle: 'Could not post credit memos',
  runningLabel: 'Posting...',
  emptyPlanNote:
    'Nothing to post in this range. Every credit memo in it either already carries a live posting or is listed below with the reason it does not.',
  usePreview: useCreditMemoPreview,
  useRunner: useCreditMemoRunner,
  renderPlanTable: ({ plan, currencyCode, gatewayNames }) => (
    <CreditMemoPlanTable plan={plan} currencyCode={currencyCode} gatewayNames={gatewayNames} />
  ),
  footerCounts: (plan) => [
    { value: plan.footer.memos, singular: 'memo', plural: 'memos' },
    { value: plan.footer.contacts, singular: 'contact', plural: 'contacts' },
  ],
  membersPosted: (summary) => ({
    value: summary.posted.reduce((total, row) => total + row.memos, 0),
    singular: 'memo',
    plural: 'memos',
  }),
  postedRows: (summary) =>
    summary.posted.map((row) => ({
      groupKey: row.groupKey,
      docNumber: row.docNumber,
      note: `${row.memos} ${row.memos === 1 ? 'memo' : 'memos'}`,
    })),
  exclusionColumns: { document: 'Credit memo', date: 'Issued' },
  // One reason per memo, first match wins (§7), so the memo's own id is unique
  // across the list.
  exclusionRow: (exclusion) => ({
    key: exclusion.creditMemoId,
    title: exclusion.number,
    dayKey: exclusion.issuedAt,
    reason: exclusion.reason,
    detail: exclusion.detail,
  }),
  exclusionCopy: EXCLUSION_COPY,
  excludedNoun: { singular: 'memo', plural: 'memos' },
}

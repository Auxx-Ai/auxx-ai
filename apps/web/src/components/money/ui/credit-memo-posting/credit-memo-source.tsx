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
//
// ## The one OPTION: issue drafts
//
// The third axis of the descriptor, and the source that made it exist. Channel
// credit memos are INGESTED as `draft` - every one of DemoOrg1's 1,061 is - and
// nothing bulk-issues them, so a dialog that only posts already-issued memos
// previews an empty plan over the entire backlog. The switch is off by default
// because issuing writes to hundreds of documents, and the empty state points
// straight at it because an unexplained empty plan reads as a broken feature.

import type {
  CreditMemoPostingExclusion,
  CreditMemoPostingExclusionReason,
  CreditMemoPostingPlan,
  CreditMemoPostingRunSummary,
} from '@auxx/lib/money/client'
import { BATCH_POSTING_GROUPINGS } from '@auxx/lib/money/client'
import { Switch } from '@auxx/ui/components/switch'
import { keepPreviousData } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import type {
  BatchPostingPreview,
  BatchPostingPreviewInput,
  BatchPostingRunner,
  BatchPostingSource,
} from '~/components/money/ui/batch-posting'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { CreditMemoPlanTable } from './credit-memo-plan-table'

/**
 * This source's extra request state.
 *
 * One field, and it is a WRITE: `issueDrafts` flips every `draft` memo the plan
 * covers to `issued` before the entry is posted.
 */
export interface CreditMemoPostingOptions {
  issueDrafts: boolean
}

/** How many rows of the failed-to-issue list are printed before it collapses. */
const ISSUE_FAILURE_ROWS_SHOWN = 12

/**
 * What each exclusion reason says on the row.
 *
 * The `detail` here is the RULE; the exclusion's own `detail` beside it is the
 * evidence. Both are needed: "before the accounting cutoff" explains nothing
 * without the cutoff, and `2026-06` explains nothing on its own.
 *
 * 🛑 A total `Record` over the closed union, so an eighth reason stops THIS file
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
    'missing-number': {
      label: 'No credit memo number',
      detail:
        'The entry keys its document number on the memo number, so a memo without one cannot be told apart from any other memo in the period it posts into. Give it a number and it posts with the next run.',
    },
    'not-issued': {
      label: 'Not issued',
      detail:
        'A draft or voided memo is not a document the ledger has an opinion about. Turn on Issue drafts above to issue the drafts as part of this run; a voided memo never posts.',
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
  options,
  enabled,
}: BatchPostingPreviewInput<CreditMemoPostingOptions>): BatchPostingPreview<CreditMemoPostingPlan> {
  const query = api.money.previewCreditMemoPosting.useQuery(
    {
      from: range?.from ?? '',
      to: range?.to ?? '',
      grouping,
      // 🛑 On the PREVIEW too, not only on the run: the plan the dialog shows has
      // to be the plan the run executes, and with the flag on the server side
      // only, the footer would read 0 postings for a run that posts 62.
      issueDrafts: options.issueDrafts,
    },
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
function useCreditMemoRunner(): BatchPostingRunner<
  CreditMemoPostingRunSummary,
  CreditMemoPostingOptions
> {
  const utils = api.useUtils()
  const postCreditMemos = api.money.runCreditMemoPosting.useMutation()

  return {
    isPending: postCreditMemos.isPending,
    run: async ({ range, grouping, options }) => {
      const summary = await postCreditMemos.mutateAsync({
        from: range.from,
        to: range.to,
        grouping,
        issueDrafts: options.issueDrafts,
      })
      // The run writes `GlPosting` rows and stamps every memo behind them, and
      // nothing on the ledger page or a memo's ledger card learns about either on
      // its own. With `issueDrafts` it also flips the memos' own status, so the
      // credit memo list is stale too.
      await Promise.all([
        utils.ledger.invalidate(),
        utils.money.creditMemoPostings.invalidate(),
        utils.money.previewCreditMemoPosting.invalidate(),
      ])
      return summary
    },
  }
}

/**
 * How many of the memos this plan excluded are DRAFTS.
 *
 * `not-issued` covers `draft` and `void` alike, and only the drafts are what the
 * switch would rescue. The exclusion's own `detail` is the memo's status
 * verbatim (`plan.ts`), which is what makes the two tellable apart here.
 */
function countExcludedDrafts(plan: CreditMemoPostingPlan): number {
  return plan.exclusions.filter(
    (exclusion) => exclusion.reason === 'not-issued' && exclusion.detail === 'draft'
  ).length
}

export const CREDIT_MEMO_POSTING_SOURCE: BatchPostingSource<
  CreditMemoPostingPlan,
  CreditMemoPostingRunSummary,
  CreditMemoPostingExclusion,
  CreditMemoPostingOptions
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
  options: {
    // 🛑 OFF. It changes document state for potentially hundreds of records in
    // one press, so it is opt-in every time the dialog opens.
    defaultValue: { issueDrafts: false },
    render: ({ value, onChange, disabled }) => (
      <FieldPanelRow
        title='Issue drafts'
        type={BaseType.BOOLEAN}
        showIcon
        description='Only drafts. A voided memo is never issued and never posts.'>
        <div className='flex items-start gap-2.5 py-1.5 pe-2'>
          <Switch
            checked={value.issueDrafts}
            onCheckedChange={(issueDrafts) => onChange({ issueDrafts })}
            disabled={disabled}
            className='mt-0.5 shrink-0'
            aria-label='Issue drafts'
          />
          <span className='text-muted-foreground text-xs'>
            Draft memos in this range are issued as part of the run, then posted into the same
            entry. Left off, they are listed below as not issued and nothing happens to them.
          </span>
        </div>
      </FieldPanelRow>
    ),
    // 🛑 The empty plan over a backlog of drafts. Channel memos arrive as
    // drafts, so this is the FIRST thing most orgs see in this dialog, and
    // "nothing to post" on its own is how somebody decides it is broken.
    emptyPlanHint: (plan, value) => {
      if (value.issueDrafts) return null
      const drafts = countExcludedDrafts(plan)
      if (drafts === 0) return null
      return (
        <>
          <strong className='font-medium'>{drafts}</strong>{' '}
          {drafts === 1
            ? 'credit memo in this range is still a draft'
            : 'credit memos in this range are still drafts'}
          . Turn on <strong className='font-medium'>Issue drafts</strong> above to issue and post
          them.
        </>
      )
    },
    // Issuing is a write to every one of them, and the footer is the last thing
    // read before the button.
    footerWarning: (plan) => {
      if (plan.footer.drafts === 0) return null
      return (
        <>
          <strong className='font-medium'>{plan.footer.drafts}</strong> of {plan.footer.memos}{' '}
          {plan.footer.memos === 1 ? 'memo' : 'memos'} will be issued, then posted. Issuing is a
          write to each one, and the entries can only be corrected by reversing them.
        </>
      )
    },
    resultNote: (summary) => {
      const { count, failed } = summary.issued
      if (count === 0 && failed.length === 0) return null
      return (
        <div>
          {count > 0 && (
            <p>
              <strong className='font-medium'>{count}</strong> draft{' '}
              {count === 1 ? 'memo was' : 'memos were'} issued by this run.
            </p>
          )}
          {failed.length > 0 && (
            <>
              {/* Not buried under the posted list: a memo that refused to issue
                  is a document somebody has to open. */}
              <p className='mt-1 flex items-start gap-1.5'>
                <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
                <span>
                  {failed.length} {failed.length === 1 ? 'memo' : 'memos'} could not be issued.{' '}
                  {failed.length === 1 ? 'It is' : 'They are'} still a draft and posted nothing.
                </span>
              </p>
              <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
                {failed.slice(0, ISSUE_FAILURE_ROWS_SHOWN).map((row) => (
                  <li key={row.creditMemoId}>
                    {row.number}: {row.reason}
                  </li>
                ))}
                {failed.length > ISSUE_FAILURE_ROWS_SHOWN && (
                  <li>and {failed.length - ISSUE_FAILURE_ROWS_SHOWN} more</li>
                )}
              </ul>
            </>
          )}
        </div>
      )
    },
  },
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

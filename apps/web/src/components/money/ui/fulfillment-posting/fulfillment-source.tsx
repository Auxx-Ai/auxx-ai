// apps/web/src/components/money/ui/fulfillment-posting/fulfillment-source.tsx
'use client'

// The bulk fulfillment posting as a REGISTRATION on the shared batch-posting
// dialog (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §5.2).
//
// *"Getting thousands of Shopify orders into the ledger without a click per
// order"* (49 §2.3) - and after the extraction, everything this file holds is
// one of the two things §5.5 says may differ per source: the plan table's
// COLUMNS and the footer's NOUNS. The frequency select, the range control, the
// refusal card, the exclusions table, the footer layout, the result page and the
// gateway-name lookup are all in `batch-posting/`.
//
// ## The range is on SHIP date
//
// Revenue is recognised when goods ship (§2.3 item 1), so the window is on the
// shipment log's `shippedAt` and never on when the order was placed or keyed.
// Both ends are inclusive on the screen and half-open on the wire (25 §6.1).

import type {
  FulfillmentPostingExclusion,
  FulfillmentPostingExclusionReason,
  FulfillmentPostingPlan,
  FulfillmentPostingRunSummary,
} from '@auxx/lib/money/client'
import { FULFILLMENT_POSTING_GROUPINGS } from '@auxx/lib/money/client'
import { keepPreviousData } from '@tanstack/react-query'
import type {
  BatchPostingPreview,
  BatchPostingPreviewInput,
  BatchPostingRunner,
  BatchPostingSource,
} from '~/components/money/ui/batch-posting'
import { api } from '~/trpc/react'
import { FulfillmentPlanTable } from './fulfillment-plan-table'

/**
 * What each exclusion reason says on the row.
 *
 * The `detail` here is the RULE; the exclusion's own `detail` beside it is the
 * evidence. Both are needed: "before the accounting cutoff" explains nothing
 * without the cutoff, and `2026-06` explains nothing on its own.
 *
 * 🛑 A total `Record` over the closed union, so a seventh reason stops THIS file
 * compiling rather than rendering as a raw slug in the shared table.
 */
const EXCLUSION_COPY: Record<FulfillmentPostingExclusionReason, { label: string; detail: string }> =
  {
    'before-cutoff': {
      label: 'Before the accounting cutoff',
      detail: 'It shipped in a period the books were opened after.',
    },
    'locked-period': {
      label: 'Locked period',
      detail: 'Its month is closed, and a closed month does not take new entries.',
    },
    'foreign-currency': {
      label: 'Foreign currency',
      detail: 'The order is not in the currency the books are kept in.',
    },
    'gateway-ambiguous': {
      label: 'Two payment gateways',
      detail: 'Which account this debits cannot be decided from the order alone.',
    },
    'test-gateway': {
      label: 'Test gateway',
      detail: 'A test checkout, which is not a sale.',
    },
    'zero-value': {
      label: 'Nothing to recognise',
      detail: 'The shipment totals zero, so there is no entry to make.',
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
function useFulfillmentPreview({
  range,
  grouping,
  enabled,
}: BatchPostingPreviewInput): BatchPostingPreview<FulfillmentPostingPlan> {
  const query = api.money.previewFulfillmentPosting.useQuery(
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
function useFulfillmentRunner(): BatchPostingRunner<FulfillmentPostingRunSummary> {
  const utils = api.useUtils()
  const post = api.money.runFulfillmentPosting.useMutation()

  return {
    isPending: post.isPending,
    run: async ({ range, grouping }) => {
      const summary = await post.mutateAsync({ from: range.from, to: range.to, grouping })
      // The run writes `GlPosting` rows and stamps every shipment behind them,
      // and nothing on the ledger page or an order's ledger card learns about
      // either on its own.
      await Promise.all([
        utils.ledger.invalidate(),
        utils.money.orderFulfillmentPostings.invalidate(),
        utils.money.previewFulfillmentPosting.invalidate(),
      ])
      return summary
    },
  }
}

export const FULFILLMENT_POSTING_SOURCE: BatchPostingSource<
  FulfillmentPostingPlan,
  FulfillmentPostingRunSummary,
  FulfillmentPostingExclusion
> = {
  sourceKey: 'fulfillment',
  title: 'Post fulfillments',
  description: 'Recognise the revenue for everything that has shipped and has no entry yet.',
  groupings: FULFILLMENT_POSTING_GROUPINGS,
  defaultGrouping: 'day',
  groupingDescription: 'How many shipments one entry summarises',
  rangeDescription: 'On the date the shipment left, not the date the order was placed',
  errorTitle: 'Could not post fulfillments',
  runningLabel: 'Posting...',
  emptyPlanNote:
    'Nothing to post in this range. Every shipment in it either already carries a live posting or is listed below with the reason it does not.',
  usePreview: useFulfillmentPreview,
  useRunner: useFulfillmentRunner,
  renderPlanTable: ({ plan, currencyCode, gatewayNames }) => (
    <FulfillmentPlanTable plan={plan} currencyCode={currencyCode} gatewayNames={gatewayNames} />
  ),
  footerCounts: (plan) => [
    { value: plan.footer.shipments, singular: 'shipment', plural: 'shipments' },
    { value: plan.footer.orders, singular: 'order', plural: 'orders' },
  ],
  membersPosted: (summary) => ({
    value: summary.posted.reduce((total, row) => total + row.shipments, 0),
    singular: 'shipment',
    plural: 'shipments',
  }),
  postedRows: (summary) =>
    summary.posted.map((row) => ({
      groupKey: row.groupKey,
      docNumber: row.docNumber,
      note: `${row.shipments} ${row.shipments === 1 ? 'shipment' : 'shipments'}`,
    })),
  exclusionColumns: { document: 'Order', date: 'Ship date' },
  exclusionRow: (exclusion) => ({
    // `(orderId, sequence)`: an order can have two shipments excluded for two
    // different reasons.
    key: `${exclusion.orderId}-${exclusion.sequence}`,
    title: exclusion.orderNumber,
    subtitle: `Shipment ${exclusion.sequence}`,
    dayKey: exclusion.shippedAt,
    reason: exclusion.reason,
    detail: exclusion.detail,
  }),
  exclusionCopy: EXCLUSION_COPY,
  excludedNoun: { singular: 'shipment', plural: 'shipments' },
}

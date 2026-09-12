// apps/web/src/components/money/ui/batch-posting/types.ts

/**
 * The one thing a bulk poster has to supply to get the whole dialog.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §5.2, §5.5.
 *
 * 🛑 **This is a descriptor, not a framework (§5.2).** §5.5 is explicit that
 * only TWO things differ per source - the plan table's COLUMNS and the footer's
 * NOUNS - and everything below is one of those two, or the pair of data hooks
 * that reach the source's own router procedures. If this file starts growing a
 * generic table engine or a generic executor, stop: that is the failure mode the
 * brief names by hand.
 *
 * Shared and therefore absent here: the dialog shell, the frequency select, the
 * range control, the refusal card, the exclusions table, the footer layout, the
 * result page, the gateway-name lookup (both sources render a routed clearing
 * account) and the currency.
 */

import type { BatchPostingGrouping } from '@auxx/lib/money/client'
import type { ReactNode } from 'react'

export type { BatchPostingGrouping }

/** The half-open window on the wire: `from <= x < to`, both `YYYY-MM-DD` (§6.1). */
export interface BatchPostingWireRange {
  from: string
  to: string
}

/** What the footer counts, in this source's nouns. */
export interface BatchPostingCount {
  value: number
  singular: string
  plural: string
}

/** The part of a plan the frame reads. A source's plan carries much more. */
export interface BatchPostingPlanShape<Exclusion> {
  footer: { postings: number; totalMinor: number }
  groups: readonly unknown[]
  exclusions: readonly Exclusion[]
}

/** The part of a run summary the frame reads. */
export interface BatchPostingSummaryShape {
  posted: ReadonlyArray<{ groupKey: string; docNumber: string }>
  skipped: ReadonlyArray<{ groupKey: string; status: string; reason: string }>
  failed: ReadonlyArray<{ groupKey: string; reason: string }>
  exclusions: readonly unknown[]
}

/** One entry the run wrote, as the result page lists it. */
export interface BatchPostingPostedRow {
  groupKey: string
  docNumber: string
  /** What it covered, in this source's nouns: `12 shipments`, `4 memos`. */
  note: string
}

/** One row of the exclusions table, in frame terms. */
export interface BatchPostingExclusionRow {
  /** Unique within the list. An order can be excluded twice for two reasons. */
  key: string
  /** The document: an order number, a memo number. */
  title: string
  /** Under it: `Shipment 2`, the contact, whatever proves WHICH one. */
  subtitle?: string
  /** `YYYY-MM-DD`. Already cut in book time server-side (see `formatDayKey`). */
  dayKey: string
  /** The source's own reason slug, looked up in {@link BatchPostingSource.exclusionCopy}. */
  reason: string
  /** The value that PROVES the reason. Never decoration (44 §7.2b). */
  detail: string
}

export interface BatchPostingPreviewInput {
  range: BatchPostingWireRange | null
  grouping: BatchPostingGrouping
  enabled: boolean
}

/** What the frame needs back from the source's preview query. */
export interface BatchPostingPreview<Plan> {
  plan: Plan | null
  /**
   * A refusal comes back ON the payload, never as a thrown error: the book time
   * zone being unset is a settings task with an address, and the dialog renders
   * it as a card beside the range it applies to (ground rule 9).
   */
  refusal: string | null
  errorMessage: string | null
  isPending: boolean
  /** True while a refetch is in flight over a kept previous plan. */
  isFetching: boolean
}

/** What the frame needs back from the source's run mutation. */
export interface BatchPostingRunner<Summary> {
  run: (input: { range: BatchPostingWireRange; grouping: BatchPostingGrouping }) => Promise<Summary>
  isPending: boolean
}

export interface BatchPostingTableProps<Plan> {
  plan: Plan
  currencyCode: string
  /**
   * `payment_gateway.clearingAccount` id -> the gateway's name. Shared, because
   * both sources render a routed clearing account (§6.5).
   */
  gatewayNames: Readonly<Record<string, string>>
}

export interface BatchPostingSource<
  Plan extends BatchPostingPlanShape<Exclusion>,
  Summary extends BatchPostingSummaryShape,
  Exclusion,
> {
  /** `'fulfillment' | 'credit_memo'`. Identity only. */
  sourceKey: string
  title: string
  description: string
  /**
   * Which groupings this source offers.
   *
   * 🛑 Per source, never a constant in the frame (§5.1): the fulfillment poster
   * dropped `week` on 2026-09-11 while `builds/backfill-policy.ts` keeps its own.
   */
  groupings: readonly BatchPostingGrouping[]
  defaultGrouping: BatchPostingGrouping
  /** The Frequency row's description: "How many shipments one entry summarises". */
  groupingDescription: string
  /** The range row's description: what the dates are ON. */
  rangeDescription: string
  /** The toast title when the run itself fails. */
  errorTitle: string
  /** The button while the run is in flight: "Posting...". */
  runningLabel: string
  /** What an empty plan says, in this source's nouns. */
  emptyPlanNote: string
  /** The preview query. 🛑 A HOOK - see the header of `batch-posting-dialog.tsx`. */
  usePreview: (input: BatchPostingPreviewInput) => BatchPostingPreview<Plan>
  /** The run mutation, including its own cache invalidation. 🛑 Also a HOOK. */
  useRunner: () => BatchPostingRunner<Summary>
  /** The plan table. Its COLUMNS are one of the two per-source halves (§5.5). */
  renderPlanTable: (props: BatchPostingTableProps<Plan>) => ReactNode
  /** The other half: what the footer counts, after the posting count. */
  footerCounts: (plan: Plan) => readonly BatchPostingCount[]
  /** How many members the run actually posted, for the result page's first line. */
  membersPosted: (summary: Summary) => BatchPostingCount
  /**
   * The posted groups as the result page lists them.
   *
   * ⚠️ Takes the whole summary rather than a row, because a property read off a
   * generic narrows to the CONSTRAINT here - `{ groupKey, docNumber }` - and a
   * per-row callback could never see this source's own fields.
   */
  postedRows: (summary: Summary) => ReadonlyArray<BatchPostingPostedRow>
  /** The first two column heads of the exclusions table. */
  exclusionColumns: { document: string; date: string }
  exclusionRow: (exclusion: Exclusion) => BatchPostingExclusionRow
  /**
   * What each reason says on the row.
   *
   * 🛑 Declare it in the source as a total `Record` over that source's closed
   * reason union, so a new reason stops THAT file compiling rather than
   * rendering here as a raw slug.
   */
  exclusionCopy: Readonly<Record<string, { label: string; detail: string }>>
  /** What the excluded rows are, for the count line: "3 shipments were excluded". */
  excludedNoun: { singular: string; plural: string }
}

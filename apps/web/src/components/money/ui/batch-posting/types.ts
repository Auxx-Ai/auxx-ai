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
 *
 * ## The third axis: OPTIONS
 *
 * §5.5's two axes held until a source needed an extra REQUEST FIELD. The credit
 * memo poster's `issueDrafts` is one: channel memos are ingested as `draft`, so
 * a dialog that can only post already-issued memos previews an empty plan over
 * the whole backlog and posts nothing.
 *
 * So a source may declare one {@link BatchPostingOptionsSlot}: a value of its
 * own shape, the control that sets it, and the three sentences that explain it -
 * the empty state's pointer at it, the footer's warning about what it will do,
 * and what the result page says it did. The frame holds the value in state,
 * resets it on every open, and threads it into `usePreview` and `run`.
 *
 * 🛑 **It is not a form engine, and adding a fourth axis needs the same
 * argument this one had.** The frame never reads INTO the value, never validates
 * it and never renders a control from a schema: the source renders its own
 * control and owns its own shape. A source that declares no slot behaves exactly
 * as it did before the slot existed.
 *
 * ## The third instance is chrome-only, on purpose
 *
 * `manufacturing/builds/backfill-dialog.tsx` is where this shape came from, and
 * it is NOT a registration here. It shares the chrome in `batch-dialog-shell.tsx`
 * and `batch-dialog-parts.tsx` and nothing else, because it answers none of this
 * descriptor's contract - not the wire range, not the grouping vocabulary, not
 * the exclusion row, not the run summary. That file's header lists the five
 * slots registering it would have cost. Read it before widening anything below
 * for a fourth caller.
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

export interface BatchPostingPreviewInput<Options = undefined> {
  range: BatchPostingWireRange | null
  grouping: BatchPostingGrouping
  /**
   * This source's own extra request state, or `undefined` when it declares no
   * {@link BatchPostingOptionsSlot}. The preview takes it because the plan the
   * dialog renders has to be the plan the run would execute (§6.4).
   */
  options: Options
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
export interface BatchPostingRunner<Summary, Options = undefined> {
  run: (input: {
    range: BatchPostingWireRange
    grouping: BatchPostingGrouping
    /** The same value the preview was taken with. See {@link BatchPostingOptionsSlot}. */
    options: Options
  }) => Promise<Summary>
  isPending: boolean
}

/** What the frame hands a source's own controls. */
export interface BatchPostingOptionsProps<Options> {
  value: Options
  onChange: (next: Options) => void
  /** True while the run is in flight. */
  disabled: boolean
}

/**
 * A source's own extra request state, and everything that explains it.
 *
 * 🛑 One slot per source, one value, and the source renders its own control.
 * See the header of this file for why this axis exists and what it is not.
 */
export interface BatchPostingOptionsSlot<Options, Plan, Summary> {
  /**
   * What a freshly opened dialog starts with.
   *
   * Re-read on every open, like the range and the frequency: an option that
   * changes what the run WRITES is opt-in every time, never remembered from a
   * dialog somebody abandoned.
   */
  defaultValue: Options
  /**
   * The control. Rendered as a direct child of the dialog's `FieldPanel`, under
   * the range row, so a `FieldPanelRow` is what belongs here.
   */
  render: (props: BatchPostingOptionsProps<Options>) => ReactNode
  /**
   * Why the plan is empty, when the answer is this option being off.
   *
   * 🛑 Rendered beside `emptyPlanNote` whenever the plan has no groups. Without
   * it the one screen that could explain a backlog of excluded documents says
   * only "nothing to post", which is how somebody concludes the feature is
   * broken.
   */
  emptyPlanHint?: (plan: Plan, value: Options) => ReactNode | null
  /**
   * What this run will do BEYOND posting, said in the footer.
   *
   * The footer is the last thing read before the button, so an option that
   * writes to documents says so there and not only in the control's caption.
   */
  footerWarning?: (plan: Plan, value: Options) => ReactNode | null
  /** What the option actually did, on the result page. */
  resultNote?: (summary: Summary) => ReactNode | null
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
  Options = undefined,
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
  /**
   * This source's own extra request field and its control (the third axis, see
   * the header). Absent means the dialog is exactly what it was without it.
   */
  options?: BatchPostingOptionsSlot<Options, Plan, Summary>
  /** The preview query. 🛑 A HOOK - see the header of `batch-posting-dialog.tsx`. */
  usePreview: (input: BatchPostingPreviewInput<Options>) => BatchPostingPreview<Plan>
  /** The run mutation, including its own cache invalidation. 🛑 Also a HOOK. */
  useRunner: () => BatchPostingRunner<Summary, Options>
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

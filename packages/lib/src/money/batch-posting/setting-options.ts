// packages/lib/src/money/batch-posting/setting-options.ts

/**
 * The `SINGLE_SELECT` option list for the two default-grouping settings,
 * `accounting.fulfillmentGrouping` and `accounting.creditMemoGrouping`
 * (`plans/accounting/tasks/done/28-how-your-books-post.md` §3.1).
 *
 * One list for both sources, because the grouping vocabulary is one
 * ({@link BATCH_POSTING_GROUPINGS}, brief 25 §5) and the two settings hold a
 * value from it. A per-source copy would let the two rows drift into offering
 * different words for the same day or month.
 *
 * Its own file, and a tiny one, for the reason
 * `money/fulfillment-posting/setting-options.ts` gives: `settings/catalog.ts`
 * is imported by the settings form and must stay client-safe, so the labels
 * live beside the vocabulary they name rather than beside the dialog that
 * renders them (`apps/web`'s `batch-posting-dialog.tsx` carries the same two
 * sentences today and should read them from here once it opens on the setting).
 *
 * The VALUES are owned by `types.ts`; only the labels are new here, and the
 * exhaustive `Record` is what makes a grouping added there a type error until
 * it is labelled.
 */

import { BATCH_POSTING_GROUPINGS, type BatchPostingGrouping } from './types'

/** What each grouping is called on the accounting settings page. */
const BATCH_POSTING_GROUPING_LABELS: Record<BatchPostingGrouping, string> = {
  day: 'One entry per day',
  month: 'One entry per month',
}

/**
 * The options the two grouping rows render, derived from the grouping list so
 * the catalog can never offer a grouping the posters do not know.
 */
export const BATCH_POSTING_GROUPING_SETTING_OPTIONS = BATCH_POSTING_GROUPINGS.map((grouping) => ({
  value: grouping,
  label: BATCH_POSTING_GROUPING_LABELS[grouping],
}))

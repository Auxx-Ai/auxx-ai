// packages/lib/src/money/credit-memo-posting/setting-options.ts

/**
 * The `SINGLE_SELECT` option list for `accounting.creditMemoPosting`
 * (`plans/accounting/tasks/28-how-your-books-post.md` §3.1).
 *
 * Its own file, and a tiny one, for the two reasons
 * `money/fulfillment-posting/setting-options.ts` gives:
 *
 * 1. **`settings/catalog.ts` must stay client-safe.** The catalog is imported by
 *    `settings/client.ts` and rendered by the settings form, so anything it
 *    reaches has to be free of `@auxx/database`, `bullmq` and friends.
 *    `auto.ts` - the module that READS this setting - enqueues a BullMQ job, so
 *    the catalog cannot import it.
 * 2. **One list, not two.** A second copy of the two modes would let the form
 *    offer a value {@link autoPostCreditMemosAfterSync} does not recognise,
 *    which falls back to `manual` silently - the failure brief 28 §11 R5 names.
 *
 * The VALUES are owned by `types.ts` ({@link CREDIT_MEMO_POSTING_MODES}); only
 * the labels are new here, and the exhaustive `Record` below is what makes a
 * mode added there a type error until it is labelled.
 */

import { CREDIT_MEMO_POSTING_MODES, type CreditMemoPostingMode } from './types'

/** What each mode is called on the accounting settings page. */
const CREDIT_MEMO_POSTING_MODE_LABELS: Record<CreditMemoPostingMode, string> = {
  manual: 'Manual, run the posting dialog',
  auto: 'Automatic after every sync',
}

/**
 * The options the `accounting.creditMemoPosting` row renders, derived from the
 * mode list so the catalog can never offer a mode the reader does not know.
 */
export const CREDIT_MEMO_POSTING_SETTING_OPTIONS = CREDIT_MEMO_POSTING_MODES.map((mode) => ({
  value: mode,
  label: CREDIT_MEMO_POSTING_MODE_LABELS[mode],
}))

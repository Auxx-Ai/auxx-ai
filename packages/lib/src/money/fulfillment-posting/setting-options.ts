// packages/lib/src/money/fulfillment-posting/setting-options.ts

/**
 * The `SINGLE_SELECT` option list for `accounting.fulfillmentPosting`
 * (`plans/money/tasks/49-bulk-fulfillment-posting.md` §2.4, §8.4 decision 1).
 *
 * Its own file, and a tiny one, for two reasons:
 *
 * 1. **`settings/catalog.ts` must stay client-safe.** The catalog is imported by
 *    `settings/client.ts` and rendered by the settings form, so anything it
 *    reaches has to be free of `@auxx/database`, `bullmq` and friends.
 *    `auto.ts` - the module that READS this setting - enqueues a BullMQ job, so
 *    the catalog cannot import it. `PAYMENT_ROUTE_SETTING_OPTIONS` lives in
 *    `money/bank-deposits/route.ts` because that file happens to be pure; this
 *    one is the same idea with the pure half split out.
 * 2. **One list, not two.** A second copy of the two modes would let the form
 *    offer a value {@link autoPostFulfillmentsAfterSync} does not recognise,
 *    which falls back to `manual` silently - the exact failure the payment-route
 *    comment warns about.
 *
 * The VALUES are owned by `types.ts` ({@link FULFILLMENT_POSTING_MODES}); only
 * the labels are new here, and the exhaustive `Record` below is what makes a
 * mode added there a type error until it is labelled.
 */

import { FULFILLMENT_POSTING_MODES, type FulfillmentPostingMode } from './types'

/** What each mode is called on the accounting settings page. */
const FULFILLMENT_POSTING_MODE_LABELS: Record<FulfillmentPostingMode, string> = {
  manual: 'Manual, run the posting dialog',
  auto: 'Automatic after every sync',
}

/**
 * The options the `accounting.fulfillmentPosting` row renders, derived from the
 * mode list so the catalog can never offer a mode the reader does not know.
 */
export const FULFILLMENT_POSTING_SETTING_OPTIONS = FULFILLMENT_POSTING_MODES.map((mode) => ({
  value: mode,
  label: FULFILLMENT_POSTING_MODE_LABELS[mode],
}))

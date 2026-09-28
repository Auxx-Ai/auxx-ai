// packages/lib/src/accounting/processors/affirm/client.ts

import type { ProcessorDescriptor } from '../types'

/**
 * Affirm settles to the bank on its own weekly `deposit_id`, never inside a Shopify
 * Payments deposit, and nets its fees on the settlement event
 * (`plans/apps/affirm/portal-probe-2026-09-15.md` §5).
 */
export const AFFIRM_PROCESSOR: ProcessorDescriptor = {
  id: 'affirm',
  label: 'Affirm',
  railName: 'Affirm',
  handles: ['affirm'],
  feeTreatment: 'netted',
  feedApp: 'affirm',
  accountLabel: 'label',
  // Any `removal_state` replaces `paid` verbatim, so every other value is a removal.
  payoutStatuses: { paid: 'paid' },
  otherPayoutStatus: 'negative',
}

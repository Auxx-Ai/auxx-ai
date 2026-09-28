// packages/lib/src/accounting/processors/authorize-net/client.ts

import type { ProcessorDescriptor } from '../types'

/**
 * Authorize.Net fronts an acquirer that settles a daily batch GROSS and bills card fees
 * monthly, so it is `billed` even though the settled-batch feed is read
 * (`plans/apps/authorize-net/authorize-net-build-plan.md` §5.2). Three spellings are in the wild.
 */
export const AUTHORIZE_NET_PROCESSOR: ProcessorDescriptor = {
  id: 'authorize_net',
  label: 'Authorize.Net',
  railName: 'Authorize.Net',
  handles: ['authorize_net', 'authorize.net', 'authorizenet'],
  feeTreatment: 'billed',
  feedApp: 'authorize-net',
  accountLabel: 'label',
  payoutStatuses: {
    settledSuccessfully: 'paid',
    pendingSettlement: 'in_transit',
    settlementError: 'negative',
  },
  otherPayoutStatus: 'in_transit',
}

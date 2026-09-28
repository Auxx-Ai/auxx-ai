// packages/lib/src/accounting/processors/stripe-connect/client.ts

import type { ProcessorDescriptor } from '../types'

/** auxx's own Stripe Connect account. A merchant's own Stripe is not read, so there is no feed app. */
export const STRIPE_CONNECT_PROCESSOR: ProcessorDescriptor = {
  id: 'stripe',
  label: 'Stripe',
  railName: 'Stripe',
  handles: ['stripe'],
  feeTreatment: 'netted',
  feedApp: null,
  accountLabel: 'label',
}

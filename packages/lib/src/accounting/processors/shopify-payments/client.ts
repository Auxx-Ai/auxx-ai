// packages/lib/src/accounting/processors/shopify-payments/client.ts

import type { ProcessorDescriptor } from '../types'

/** The installed app whose tools read Shopify Payments. */
export const SHOPIFY_APP_SLUG = 'shopify'

/**
 * Shopify Payments. One rail, three handles: Shop Pay Installments and Shop Cash
 * arrive in the same Shopify deposit, so splitting them makes it unsplittable (brief 26 §2).
 */
export const SHOPIFY_PAYMENTS_PROCESSOR: ProcessorDescriptor = {
  id: 'shopify_payments',
  label: 'Shopify Payments',
  railName: 'Shopify Payments',
  handles: ['shopify_payments', 'shop_pay_installments', 'shop_cash'],
  feeTreatment: 'netted',
  feedApp: SHOPIFY_APP_SLUG,
  accountLabel: 'label',
  payoutStatuses: {
    paid: 'paid',
    scheduled: 'in_transit',
    in_transit: 'in_transit',
    failed: 'negative',
    canceled: 'negative',
  },
  otherPayoutStatus: 'in_transit',
}

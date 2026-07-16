// packages/lib/src/money/billing-config.ts

import { BadRequestError } from '../errors'
import { COMPATIBLE_BILLING_TIMINGS } from './client'
import type { WorkOrderBillingBasis, WorkOrderInvoiceTiming } from './types'

/** Return whether a work-order billing basis and timing have defined product semantics. */
export function isBillingConfigurationCompatible(
  basis: WorkOrderBillingBasis,
  timing: WorkOrderInvoiceTiming
): boolean {
  return COMPATIBLE_BILLING_TIMINGS[basis]?.includes(timing) ?? false
}

/** Reject billing configurations that the invoice builder would otherwise need to reinterpret. */
export function assertBillingConfigurationCompatible(
  basis: WorkOrderBillingBasis,
  timing: WorkOrderInvoiceTiming
): void {
  if (!isBillingConfigurationCompatible(basis, timing)) {
    throw new BadRequestError(`Invoice timing '${timing}' is not valid for '${basis}' billing`)
  }
}

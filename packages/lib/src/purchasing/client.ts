// packages/lib/src/purchasing/client.ts

// Client-safe entry point for the purchasing math. Everything re-exported here
// is a pure function or a type — no database, no tRPC, no server-only imports —
// so the UI can preview a landed cost or a three-way match before anything is
// committed (build plan sections 4.3 and 6.1).
//
// NOTE: no 'use client' directive. This file is imported by server code too (the
// receive write path and the bill match hook); the directive would turn every
// export into a client-reference proxy there. See project memory
// "'use client' in lib client.ts breaks server imports".

export {
  allocateCapitalisedCost,
  allocateLandedCost,
  capitalisableAmount,
} from './allocate-landed-cost'
export {
  DEFAULT_MATCH_TOLERANCE,
  describeMatchReason,
  describeMatchReasons,
  matchBill,
  matchBillLine,
  matchVariance,
  priceAllowance,
} from './match'
export type {
  PurchaseOrderBillingStatusValue,
  PurchaseOrderDerivedStatuses,
  PurchaseOrderLineQuantities,
  PurchaseOrderReceiptStatusValue,
} from './purchase-order-status'
// The pure classifier only. 🛑 `recalculatePurchaseOrderStatuses` (its writer sibling)
// reads and writes the database and must NEVER be re-exported here.
export { derivePurchaseOrderStatuses } from './purchase-order-status'
export type {
  AllocationBasis,
  AllocationHeader,
  AllocationLine,
  MatchLine,
  MatchReason,
  MatchResult,
  MatchTolerance,
} from './types'

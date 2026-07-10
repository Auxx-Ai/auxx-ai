// packages/lib/src/money/client.ts
'use client'

// Pure math + types only — no `@auxx/database`/server deps. Lets the line-builder
// footer (§H.1) render live optimistic totals with the exact same function the
// server-side recompute hook uses (money MQ1 build spec §F.1).
export { computeDocumentTotals, computeLineTotal, round2 } from './totals'
export type { DiscountType, DocumentBillingInputs, DocumentTotals, LineForTotals } from './types'

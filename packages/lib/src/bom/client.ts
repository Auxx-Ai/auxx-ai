// packages/lib/src/bom/client.ts

/**
 * Client-safe surface of the BOM module.
 *
 * The drawer's Suppliers tab needs the landed-cost formula and the
 * winning-supplier rule; it must NOT reach for `bom/index.ts`, which pulls the
 * cost calculator and with it drizzle, the org cache and the realtime service.
 *
 * No `'use client'` directive here on purpose — server code imports these
 * functions too (the calculator itself does), and the directive would turn
 * every export into a client-reference proxy on that side.
 */

export type { LandedCostBreakdown, VendorCostRow } from './vendor-cost'
export {
  computeLandedBreakdown,
  computeLandedCost,
  selectWinningVendor,
} from './vendor-cost'

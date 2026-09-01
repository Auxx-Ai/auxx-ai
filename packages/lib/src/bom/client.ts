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

export type {
  LandedCostBreakdown,
  OfferTariff,
  OfferTariffInputs,
  TariffRateComponent,
  TariffRateRow,
  TariffResolution,
  TariffResolutionStatus,
  VendorCostRow,
} from './vendor-cost'
export {
  composeTariffCodeLabel,
  computeLandedBreakdown,
  computeLandedCost,
  // The supplier form, the Suppliers tab, the Receive form and the Classification
  // tab all decide an offer's rate through this one function (30 §1).
  resolveOfferTariff,
  // The tariffs settings screen and the supplier drawer resolve the schedule in
  // the browser through this export. Resolving server-side only and shipping
  // the client a number is how the landed formula came to live in two places.
  resolveTariffRate,
  selectWinningVendor,
} from './vendor-cost'

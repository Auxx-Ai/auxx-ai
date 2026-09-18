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

// The starter catalogue's TYPES and its pure expander are client-safe; the
// picker previews exactly the rows the mutation will write by running them
// through `resolveTariffRate`. The DATA stays server-side (32 §1.2, §1.4): the
// hand-kept actions table reaches the browser through `purchasing.listTariffStarters`
// and the generated HTS file never leaves the server.
export type {
  ActionKey,
  StarterAction,
  StarterExpansion,
  StarterRow,
  StarterStep,
} from './tariff-starters'
export { expandTariffStarter, membershipsFor, starterNote } from './tariff-starters'

// packages/lib/src/bom/index.ts

export {
  type AdoptTariffStartersInput,
  type AdoptTariffStartersResult,
  adoptTariffStarters,
} from './adopt-tariff-starters'
export { type ApplyTariffScheduleResult, applyTariffSchedule } from './apply-tariff-schedule'
export { recalculateAffectedParts, recalculateAllPartCosts } from './cost-calculator'
export { batchRecalculateQoH } from './qoh'
export {
  applyTariffResync,
  MFN_ACTION_KEY,
  planTariffResync,
  type ResyncAction,
  type ResyncAddition,
  type ResyncApplyResult,
  type ResyncCode,
  type ResyncDeps,
  type ResyncDivergence,
  type ResyncPlan,
} from './resync-tariff-starters'
export { getDeductionTargets, loadDirectSubparts, loadSubpartGraph } from './subpart-graph'
export {
  loadTariff301Memberships,
  loadTariffMemberships,
  type Tariff301Memberships,
  type TariffMemberships,
} from './tariff-301-memberships'
export {
  findHtsGeneral,
  type HtsGeneralCatalogue,
  type HtsGeneralLine,
  type HtsNode,
  listHtsChildren,
  loadHtsGeneral,
  normalizeHtsCode,
  searchHtsGeneral,
} from './tariff-hts-general'
export { loadTariffSchedule, readBookTimeZone } from './tariff-schedule'
export type {
  ActionKey,
  StarterAction,
  StarterExpansion,
  StarterRow,
  StarterStep,
} from './tariff-starters'
export {
  expandTariffStarter,
  MFN_EFFECTIVE_FROM,
  membershipsFor,
  starterNote,
  TARIFF_ACTIONS,
  TARIFF_STARTERS_VERSION,
} from './tariff-starters'
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
  resolveOfferTariff,
  resolveTariffRate,
  selectWinningVendor,
} from './vendor-cost'

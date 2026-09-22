// packages/lib/src/accounting/ledger/setup/index.ts

export { readBookTimeZone, readBookTimeZoneOrUtc, todayInBookTimeZone } from './book-time-zone'
// TARGET §3: the export batch's settings, beside `autoPost`.
export {
  AUTO_POST_AVENUES,
  type AutoPostAvenue,
  avenueOfPostingType,
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  isSummaryGrainAvenue,
  SUMMARY_GRAIN_AVENUES,
  type SummaryGrain,
  type SummaryGrainAvenue,
} from './export-settings'
export { readExportSettings } from './read-export-settings'
export {
  type OpeningTrialBalanceSummary,
  openingTrialBalanceDifference,
  resolveSetupReadiness,
  type SetupReadiness,
  type SetupReadinessContext,
  summariseOpeningTrialBalance,
} from './setup-readiness'

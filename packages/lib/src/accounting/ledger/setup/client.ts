// packages/lib/src/accounting/ledger/setup/client.ts

// TARGET §3: the export batch's settings. `readExportSettings` stays
// server-only (`./index`) - these three reach nothing but `../../types`.
export {
  avenueOfPostingType,
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  SUMMARY_GRAIN_AVENUES,
  type SummaryGrain,
  type SummaryGrainAvenue,
} from './export-settings'
export { LEDGER_CURRENCY } from './ledger-currency'
// The readiness extension: a fourth requirement whose input is not a setting.
// Exported here rather than folded into the `setup-readiness` block above so
// this slot appended, per HANDOFF §9a, instead of editing another slot's lines.
export {
  ABSORPTION_RATE_SETTING_KEYS,
  describeUnscopedSources,
  FINALIZED_SETUP_STATE,
  isValidTimeZone,
  isWholeMinorUnits,
  minorUnitError,
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningTrialBalanceSummary,
  openingDifference,
  openingDifferenceRows,
  openingTrialBalanceDifference,
  type ReadinessRequirement,
  readSettingMinorUnits,
  readSettingText,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
  type SetupReadiness,
  type SetupReadinessContext,
  summariseOpeningTrialBalance,
  type UnscopedSourceConnection,
  type UnscopedSourceRole,
  type UnscopedSourceWarning,
} from './setup-readiness'

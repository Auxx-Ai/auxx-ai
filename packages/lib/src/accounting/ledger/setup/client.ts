// packages/lib/src/accounting/ledger/setup/client.ts

// TARGET §3: the export batch's settings. `readExportSettings` stays
// server-only (`./index`) - these three reach nothing but `../../types`.
export {
  avenueOfPostingType,
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  isSummaryGrain,
  isSummaryGrainAvenue,
  SUMMARY_GRAIN_AVENUES,
  SUMMARY_GRAINS,
  type SummaryGrain,
  type SummaryGrainAvenue,
} from './export-settings'
export { LEDGER_CURRENCY } from './ledger-currency'
// The readiness extension: the one requirement whose input is not a setting.
// Exported here rather than folded into the `setup-readiness` block above so
// this slot appended, per HANDOFF §9a, instead of editing another slot's lines.
export {
  CUTOVER_FLOOR_KINDS,
  CUTOVER_FLOOR_REQUIREMENT_KEY,
  type CutoverFloorFinding,
  type CutoverFloorKind,
  describeCutoverFloor,
  describeUnscopedSources,
  FINALIZED_SETUP_STATE,
  isMonthKey,
  isValidTimeZone,
  OPENING_BASELINE_SETTING_KEYS,
  OPENING_FROM_NOTHING_SETTING_KEY,
  type OpeningPresence,
  type OpeningTrialBalanceSummary,
  openingTrialBalanceDifference,
  type ReadinessRequirement,
  readOpeningFromNothing,
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

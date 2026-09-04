// apps/web/src/components/accounting/ui/settings/accounting-settings-keys.ts
//
// The setting keys the three accounting settings pages read and write, plus the
// two small predicates every one of them needs.
//
// The key names are spelled out for readability at the call sites, but they are
// NOT a second source of truth: `buildReadinessRecord` below feeds the shared
// predicate from `SETUP_READINESS_SETTING_KEYS`, so the keys the readiness
// answer is computed over can never drift from the ones the predicate declares.
// `OPENING_BASELINE_SETTING_KEYS` and `FINALIZED_SETUP_STATE` are also exported
// from `@auxx/lib/postings/client` if a caller wants them by reference.

import {
  minorUnitError,
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
} from '@auxx/lib/postings/client'

/** Every `accounting.*` / `manufacturing.*` key these pages touch. */
export const ACCOUNTING_KEYS = {
  setupState: 'accounting.setupState',
  cutoffPeriod: 'accounting.cutoffPeriod',
  bookTimeZone: 'accounting.bookTimeZone',
  setupFinalizedAt: 'accounting.setupFinalizedAt',
  setupFinalizedByUserId: 'accounting.setupFinalizedByUserId',
  openingRawMaterials: 'accounting.openingRawMaterials',
  openingWip: 'accounting.openingWip',
  openingFinishedGoods: 'accounting.openingFinishedGoods',
  qboOpeningRawMaterials: 'accounting.qboOpeningRawMaterials',
  qboOpeningWip: 'accounting.qboOpeningWip',
  qboOpeningFinishedGoods: 'accounting.qboOpeningFinishedGoods',
  qboOpeningJournalRef: 'accounting.qboOpeningJournalRef',
  assemblyLaborCostPerUnit: 'manufacturing.assemblyLaborCostPerUnit',
  overheadCostPerUnit: 'manufacturing.overheadCostPerUnit',
  autoRollFirstStandard: 'manufacturing.autoRollFirstStandard',
} as const

/**
 * 🛑 Draft scoping. `useSettings({ scope: 'GENERAL' })` returns EVERY
 * `GENERAL`-scope setting in the whole app, and every `accounting.*` key is
 * `GENERAL` (there is no `ACCOUNTING` value in `SettingScope`). A save built
 * from the whole record would write back unrelated settings, so each section
 * narrows its draft to one of these arrays and diffs only against it.
 */
export const PERIOD_DRAFT_KEYS = [
  ACCOUNTING_KEYS.cutoffPeriod,
  ACCOUNTING_KEYS.bookTimeZone,
] as const

export const ABSORPTION_DRAFT_KEYS = [
  ACCOUNTING_KEYS.assemblyLaborCostPerUnit,
  ACCOUNTING_KEYS.overheadCostPerUnit,
  ACCOUNTING_KEYS.autoRollFirstStandard,
] as const

export const OPENING_DRAFT_KEYS = [
  ACCOUNTING_KEYS.openingRawMaterials,
  ACCOUNTING_KEYS.openingWip,
  ACCOUNTING_KEYS.openingFinishedGoods,
  ACCOUNTING_KEYS.qboOpeningRawMaterials,
  ACCOUNTING_KEYS.qboOpeningWip,
  ACCOUNTING_KEYS.qboOpeningFinishedGoods,
  ACCOUNTING_KEYS.qboOpeningJournalRef,
] as const

/** The three opening balances, paired auxx snapshot against provider snapshot. */
export const OPENING_PAIRS = [
  {
    role: 'inventory_raw_materials' as const,
    accountCode: '1310',
    label: 'Raw materials',
    auxxKey: ACCOUNTING_KEYS.openingRawMaterials,
    qboKey: ACCOUNTING_KEYS.qboOpeningRawMaterials,
  },
  {
    role: 'inventory_wip' as const,
    accountCode: '1320',
    label: 'Work in process',
    auxxKey: ACCOUNTING_KEYS.openingWip,
    qboKey: ACCOUNTING_KEYS.qboOpeningWip,
  },
  {
    role: 'inventory_finished_goods' as const,
    accountCode: '1330',
    label: 'Finished goods',
    auxxKey: ACCOUNTING_KEYS.openingFinishedGoods,
    qboKey: ACCOUNTING_KEYS.qboOpeningFinishedGoods,
  },
]

/**
 * Where each readiness requirement is fixed.
 *
 * Keyed by `ReadinessRequirement.key`, which `resolveSetupReadiness` keeps in
 * step with the getting-started goal keys.
 */
export const READINESS_LINKS: Record<string, { label: string; href: string }> = {
  'set-accounting-period': {
    label: 'Accounting period',
    href: '/app/accounting/settings/general',
  },
  'set-opening-balances': {
    label: 'Opening balances',
    href: '/app/accounting/settings/opening',
  },
  // Added by HANDOFF slot 1C. Same page as the row above: the inventory
  // snapshot and the full trial balance are two panels of `settings/opening`,
  // and they are two requirements because they can fail independently.
  'set-opening-trial-balance': {
    label: 'Opening trial balance',
    href: '/app/accounting/settings/opening',
  },
  'set-costing': {
    label: 'Absorption rates',
    href: '/app/accounting/settings/general',
  },
}

/**
 * Feed the shared predicate.
 *
 * Built from `SETUP_READINESS_SETTING_KEYS` so the record carries exactly what
 * the predicate reads. `getSetting` falls back to the catalog default, which is
 * `null` for every key here except `accounting.setupState` (`'draft'`), and a
 * `null` must stay a `null`, because an unset currency absorbs nothing while a
 * zero is a real choice.
 */
export function buildReadinessRecord(getSetting: (key: string) => unknown): SettingsRecord {
  const record: SettingsRecord = {}
  for (const key of SETUP_READINESS_SETTING_KEYS) record[key] = getSetting(key)
  return record
}

// ── The minor-unit and text predicates: ONE authority, in lib ───────────────
//
// 🛑 These are re-exports, not copies. The rule "an opening balance is whole
// minor units" decides whether a setup can close, and it was briefly written in
// three places at once - here, in the wizard pages, and in
// `postings/setup-readiness.ts`. Three copies of a validation rule drift, and
// the drift is silent: the form accepts a value the reader later refuses, so the
// setup SAVES and then cannot close. The lib copy is the one the server also
// reads, so it is the one that wins.
export {
  minorUnitError,
  readSettingMinorUnits as readMinorUnits,
  readSettingText as readText,
} from '@auxx/lib/postings/client'

/** True when every value in `record` under `keys` is a legal minor-unit amount. */
export function everyMinorUnitValid(record: Record<string, unknown>, keys: readonly string[]) {
  return keys.every((key) => minorUnitError(record[key]) === undefined)
}

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
// from `@auxx/lib/accounting/ledger/client` if a caller wants them by reference.

import {
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
} from '@auxx/lib/accounting/ledger/client'

/** Every `accounting.*` / `manufacturing.*` key these pages touch. */
export const ACCOUNTING_KEYS = {
  setupState: 'accounting.setupState',
  cutoffPeriod: 'accounting.cutoffPeriod',
  bookTimeZone: 'accounting.bookTimeZone',
  fiscalYearStartMonth: 'accounting.fiscalYearStartMonth',
  // TARGET §3, gate 2: the export mode and its cutover. General renders these
  // beside the period settings above - same "when does history stop mattering"
  // shape as the accounting cutoff itself.
  exportMode: 'accounting.exportMode',
  exportModeCutover: 'accounting.exportModeCutover',
  setupFinalizedAt: 'accounting.setupFinalizedAt',
  setupFinalizedByUserId: 'accounting.setupFinalizedByUserId',
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
  ACCOUNTING_KEYS.fiscalYearStartMonth,
] as const

export const EXPORT_DRAFT_KEYS = [
  ACCOUNTING_KEYS.exportMode,
  ACCOUNTING_KEYS.exportModeCutover,
] as const

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
}

/** Feed the shared predicate exactly the keys it reads. */
export function buildReadinessRecord(getSetting: (key: string) => unknown): SettingsRecord {
  const record: SettingsRecord = {}
  for (const key of SETUP_READINESS_SETTING_KEYS) record[key] = getSetting(key)
  return record
}

export { readSettingText as readText } from '@auxx/lib/accounting/ledger/client'

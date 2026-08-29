// packages/lib/src/postings/setup-readiness.ts
//
// Whether an organization's accounting setup is ready, as a PURE function over a
// settings record.
//
// PURE and CLIENT-SAFE. No database, no clock, no io - it is handed the settings
// and answers a question about them.
//
// ── Why this file exists, and why it is not a query ─────────────────────────
//
// plans/money/tasks/12-accounting-setup.md is explicit that readiness is
// "derived on read, not stored - a stored readiness flag goes stale the moment
// somebody changes a rate." The front end already satisfies that for free:
// `useSettings` rides the org cache, hydrated by the provider, so every
// `accounting.*` key is in hand on load at ZERO queries.
//
// 🛑 So there is deliberately no `setupReadiness` endpoint. What there is
// instead is ONE predicate with TWO callers:
//
//   * `getting-started/signals.ts` calls it server-side against cached settings,
//     to light up the onboarding checklist.
//   * the accounting settings pages call it client-side against `useSettings`,
//     to render "not configured yet" hints inline.
//
// Writing that arithmetic twice is the thing that would rot: the two copies
// drift and the checklist starts disagreeing with the button.
//
// ── What this is NOT ────────────────────────────────────────────────────────
//
// 🛑 This does not gate Post. `previewMonthEnd`'s `blockedBy` does, and the
// difference is the whole point: this file can say "costing is not set up",
// but only the server knows WHICH part has no standard cost or WHICH movement
// is uncosted. A checklist nudges; a refusal names the row.
//
// Three requirements are therefore absent here by design - they are facts about
// rows, not settings, and each belongs to a page that already loads them:
// the standard-cost roll (part rows), the role map (`GlRoleAssignment` rows),
// and whether a first entry is posted (`GlPosting` rows).

/**
 * The settings the opening baseline is read from.
 *
 * 🛑 Declared HERE rather than in `opening-baseline.ts` even though that is the
 * module that reads them, because this file is client-safe and that one is not -
 * it imports `settings-service`, which reaches the database. A browser importing
 * these keys through that file would drag the server graph into the bundle.
 * `opening-baseline.ts` re-exports them, so the server side is unaffected.
 */
export const OPENING_BASELINE_SETTING_KEYS = {
  setupState: 'accounting.setupState',
  cutoffPeriod: 'accounting.cutoffPeriod',
  bookTimeZone: 'accounting.bookTimeZone',
  inventory_raw_materials: 'accounting.openingRawMaterials',
  inventory_wip: 'accounting.openingWip',
  inventory_finished_goods: 'accounting.openingFinishedGoods',
} as const

/** The value `accounting.setupState` must hold before anything may post. */
export const FINALIZED_SETUP_STATE = 'finalized' as const

/**
 * The absorption rates, which live under `manufacturing.*` rather than
 * `accounting.*` because they predate this module - `G9` calls them business
 * inputs, not a fixture gap.
 */
export const ABSORPTION_RATE_SETTING_KEYS = {
  assemblyLabor: 'manufacturing.assemblyLaborCostPerUnit',
  overhead: 'manufacturing.overheadCostPerUnit',
} as const

/** Every setting key this predicate reads. Handy for scoping a settings draft. */
export const SETUP_READINESS_SETTING_KEYS = [
  ...Object.values(OPENING_BASELINE_SETTING_KEYS),
  'accounting.qboOpeningRawMaterials',
  'accounting.qboOpeningWip',
  'accounting.qboOpeningFinishedGoods',
  'accounting.qboOpeningJournalRef',
  ...Object.values(ABSORPTION_RATE_SETTING_KEYS),
] as const

/** A settings record as `useSettings`/`getAllOrganizationSettings` hand it over. */
export type SettingsRecord = Record<string, unknown>

/** One requirement, resolved. */
export interface ReadinessRequirement {
  /** Stable id. Matches the getting-started goal key where one exists. */
  key: string
  met: boolean
  /** Why it is not met, in words a person can act on. Absent when `met`. */
  reason?: string
}

export interface SetupReadiness {
  /** Every settings-derived requirement, in display order. */
  requirements: ReadinessRequirement[]
  /** True when every requirement above is met. Says nothing about the row-level facts. */
  settingsReady: boolean
  /** `accounting.setupState === 'finalized'`. */
  finalized: boolean
}

/**
 * A `CURRENCY` setting, normalized.
 *
 * ⚠️ `null` and `0` are NOT interchangeable and this is the one place that most
 * wants to conflate them. `0` is a legitimate opening balance - a business with
 * no work in process at cutover has exactly that - so a null read as zero would
 * report a baseline nobody supplied. Same rule `loadAbsorptionRates` follows.
 */
export function readSettingMinorUnits(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/**
 * ⚠️ The catalog cannot enforce integer minor units and it was verified that it
 * does not: `normalizeSettingValue` routes `CURRENCY` through
 * `fieldValueSchemas.number`, which accepts `12.5` and even coerces `"12.50"`.
 * `readOpeningBaseline` refuses a fractional value on the read side, so without a
 * check here the failure mode is a setup that SAVES and then cannot close.
 */
export function isWholeMinorUnits(value: unknown): boolean {
  const n = readSettingMinorUnits(value)
  return n !== null && Number.isInteger(n)
}

/**
 * The same rule as {@link isWholeMinorUnits}, phrased for a form field.
 *
 * `null` is deliberately NOT an error here - "not configured" is
 * {@link resolveSetupReadiness}'s answer to give, not this one's. A field that
 * reported both would say "required" twice in two vocabularies.
 */
export function minorUnitError(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Must be a number of cents.'
  if (!Number.isInteger(value)) return 'Must be a whole number of cents, with no fraction.'
  return undefined
}

export function readSettingText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Whether a string names a zone this runtime knows. No UTC fallback, ever. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Resolve every settings-derived setup requirement.
 *
 * Coarse on purpose - one requirement per wizard page, matching
 * `ACCOUNTING_GOAL_KEYS`. Cutoff and book timezone are two inputs on one page
 * and are reported as one row.
 */
export function resolveSetupReadiness(settings: SettingsRecord): SetupReadiness {
  const K = OPENING_BASELINE_SETTING_KEYS
  const R = ABSORPTION_RATE_SETTING_KEYS

  const cutoff = readSettingText(settings[K.cutoffPeriod])
  const zone = readSettingText(settings[K.bookTimeZone])
  const periodReason = !cutoff
    ? 'No cutoff period set.'
    : !MONTH_KEY.test(cutoff)
      ? `Cutoff period "${cutoff}" is not a YYYY-MM month.`
      : !zone
        ? 'No book timezone set. There is no UTC fallback.'
        : !isValidTimeZone(zone)
          ? `"${zone}" is not a valid IANA timezone.`
          : undefined

  const auxxKeys = [K.inventory_raw_materials, K.inventory_wip, K.inventory_finished_goods]
  const qboKeys = [
    'accounting.qboOpeningRawMaterials',
    'accounting.qboOpeningWip',
    'accounting.qboOpeningFinishedGoods',
  ]
  const missingBalance = [...auxxKeys, ...qboKeys].some(
    (k) => readSettingMinorUnits(settings[k]) === null
  )
  const fractional = [...auxxKeys, ...qboKeys].some(
    (k) => readSettingMinorUnits(settings[k]) !== null && !isWholeMinorUnits(settings[k])
  )
  const journalRef = readSettingText(settings['accounting.qboOpeningJournalRef'])
  const difference = openingDifference(settings)

  const openingReason = missingBalance
    ? 'Some opening balances are not set. Zero is a real balance; unset is not.'
    : fractional
      ? 'An opening balance is not a whole number of cents.'
      : !journalRef
        ? 'No QuickBooks opening journal reference.'
        : difference !== 0
          ? 'The auxx and QuickBooks opening snapshots do not agree.'
          : undefined

  const labor = readSettingMinorUnits(settings[R.assemblyLabor])
  const overhead = readSettingMinorUnits(settings[R.overhead])
  const costingReason =
    labor === null
      ? 'No assembly labor rate. An unset rate absorbs nothing.'
      : overhead === null
        ? 'No overhead rate. An unset rate absorbs nothing.'
        : undefined

  const requirements: ReadinessRequirement[] = [
    { key: 'set-accounting-period', met: !periodReason, reason: periodReason },
    { key: 'set-opening-balances', met: !openingReason, reason: openingReason },
    { key: 'set-costing', met: !costingReason, reason: costingReason },
  ]

  return {
    requirements,
    settingsReady: requirements.every((r) => r.met),
    finalized: readSettingText(settings[K.setupState]) === 'finalized',
  }
}

/**
 * Auxx total minus QuickBooks total, in minor units.
 *
 * 🛑 Neither number silently overrides the other, which is why this is a
 * difference rather than a fallback. A difference falling into January's
 * balancing plug would classify a cutover problem as January COGS; the auxx
 * number alone would let QuickBooks and the subledger disagree from day one.
 *
 * Returns `0` when a figure is missing - "not configured" is reported by
 * {@link resolveSetupReadiness}, not smuggled in here as a fake disagreement.
 */
export function openingDifference(settings: SettingsRecord): number {
  const K = OPENING_BASELINE_SETTING_KEYS
  const pairs: Array<[string, string]> = [
    [K.inventory_raw_materials, 'accounting.qboOpeningRawMaterials'],
    [K.inventory_wip, 'accounting.qboOpeningWip'],
    [K.inventory_finished_goods, 'accounting.qboOpeningFinishedGoods'],
  ]
  return pairs.reduce((total, [auxxKey, qboKey]) => {
    const auxx = readSettingMinorUnits(settings[auxxKey])
    const qbo = readSettingMinorUnits(settings[qboKey])
    if (auxx === null || qbo === null) return total
    return total + (auxx - qbo)
  }, 0)
}

/** Per-account difference rows, for the reconciliation panel. */
export function openingDifferenceRows(settings: SettingsRecord): Array<{
  role: 'inventory_raw_materials' | 'inventory_wip' | 'inventory_finished_goods'
  auxx: number | null
  qbo: number | null
  difference: number | null
}> {
  const K = OPENING_BASELINE_SETTING_KEYS
  const rows = [
    {
      role: 'inventory_raw_materials' as const,
      a: K.inventory_raw_materials,
      q: 'accounting.qboOpeningRawMaterials',
    },
    { role: 'inventory_wip' as const, a: K.inventory_wip, q: 'accounting.qboOpeningWip' },
    {
      role: 'inventory_finished_goods' as const,
      a: K.inventory_finished_goods,
      q: 'accounting.qboOpeningFinishedGoods',
    },
  ]
  return rows.map(({ role, a, q }) => {
    const auxx = readSettingMinorUnits(settings[a])
    const qbo = readSettingMinorUnits(settings[q])
    return {
      role,
      auxx,
      qbo,
      difference: auxx === null || qbo === null ? null : auxx - qbo,
    }
  })
}

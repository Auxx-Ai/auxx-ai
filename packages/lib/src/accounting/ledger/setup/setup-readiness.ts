// packages/lib/src/accounting/ledger/setup/setup-readiness.ts
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
// instead is ONE predicate with three callers:
//
//   * `getting-started/signals.ts` calls it server-side against cached settings,
//     to light up the onboarding checklist.
//   * the accounting settings pages call it client-side against `useSettings`,
//     to render "not configured yet" hints inline.
//   * `finalizeAccountingSetup` re-checks it server-side and refuses when unmet.
//
// Writing that arithmetic twice is the thing that would rot: the two copies
// drift and the checklist starts disagreeing with the button.
//
// ── What this is NOT ────────────────────────────────────────────────────────
//
// 🛑 This does not gate an individual post. `previewMonthEnd`'s `blockedBy` does, and the
// difference is the whole point: this file can say "the period is not set",
// but only the server knows WHICH part has no standard cost or WHICH movement
// is uncosted. A checklist nudges; a refusal names the row.
//
// Three requirements are therefore absent here by design - they are facts about
// rows, not settings, and each belongs to a page that already loads them:
// the standard-cost roll (part rows), the role map (`GlRoleAssignment` rows),
// and whether a first entry is posted (`GlPosting` rows).
//
// ⚠️ {@link describeUnscopedSources} is the one exception, and it is not a
// requirement - it is an ADVISORY (task 47 §8). It never joins `requirements`
// and never moves `settingsReady`, because connecting a second store must not
// stop the books (decision D6). It lives here because it is the same kind of
// thing every other export in this file is - a pure predicate over what a screen
// already holds - and because the alternative was a second copy of the sentence
// in the one screen that renders it.

/** The setup settings every posting path and the setup screens read. */
export const OPENING_BASELINE_SETTING_KEYS = {
  setupState: 'accounting.setupState',
  cutoffPeriod: 'accounting.cutoffPeriod',
  bookTimeZone: 'accounting.bookTimeZone',
} as const

/** The value `accounting.setupState` must hold before anything may post. */
export const FINALIZED_SETUP_STATE = 'finalized' as const

/**
 * The org's declaration that its books begin at the cutover, so there is no
 * opening entry to make. An affirmation, because an empty opening cannot tell
 * "we started from nothing" from "nobody filled this in".
 */
export const OPENING_FROM_NOTHING_SETTING_KEY = 'accounting.openingFromNothing' as const

/** Whether the org declared it carries no opening balances. */
export function readOpeningFromNothing(settings: SettingsRecord): boolean {
  return settings[OPENING_FROM_NOTHING_SETTING_KEY] === true
}

/** Every setting key this predicate reads. Handy for scoping a settings draft. */
export const SETUP_READINESS_SETTING_KEYS = [
  ...Object.values(OPENING_BASELINE_SETTING_KEYS),
  OPENING_FROM_NOTHING_SETTING_KEY,
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
  /** Every requirement, in display order. */
  requirements: ReadinessRequirement[]
  /** True when every requirement above is met. Says nothing about the row-level facts. */
  settingsReady: boolean
  /** `accounting.setupState === 'finalized'`. */
  finalized: boolean
}

/** The trial-balance summary of the opening entry's lines. */
export interface OpeningTrialBalanceSummary {
  /** Σ of every debit row, integer minor units. */
  debitMinor: number
  /** Σ of every credit row, integer minor units. */
  creditMinor: number
  /** How many non-zero rows the trial balance holds. Zero means "nothing entered". */
  rows: number
}

/** Where the opening entry stands: posted, or a draft with these totals. */
export interface OpeningPresence {
  posted: boolean
  summary: OpeningTrialBalanceSummary
}

/** Everything this predicate needs that is NOT a setting. */
export interface SetupReadinessContext {
  /**
   * The opening entry, from `readOpeningPresence` or `ledgerOpening.get`. Absent reads as
   * met so a screen still loading it does not flash red; `finalizeAccountingSetup` always
   * passes it, and that is the gate.
   */
  opening?: OpeningPresence
}

/** Σ debits − Σ credits over a trial balance, in integer minor units. */
export function openingTrialBalanceDifference(
  lines: readonly { direction: 'debit' | 'credit'; amountMinor: number }[]
): number {
  return summariseOpeningTrialBalance(lines).differenceMinor
}

/** Both totals, the difference, and how many rows carry an amount. */
export function summariseOpeningTrialBalance(
  lines: readonly { direction: 'debit' | 'credit'; amountMinor: number }[]
): OpeningTrialBalanceSummary & { differenceMinor: number } {
  let debitMinor = 0
  let creditMinor = 0
  let rows = 0
  for (const line of lines) {
    if (!Number.isFinite(line.amountMinor) || line.amountMinor === 0) continue
    rows += 1
    if (line.direction === 'debit') debitMinor += line.amountMinor
    else creditMinor += line.amountMinor
  }
  return { debitMinor, creditMinor, rows, differenceMinor: debitMinor - creditMinor }
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

/** A well-formed `YYYY-MM` month key. */
export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value)
}

/** Why the opening is not ready, or undefined when it is (plans/accounting/tasks/103 §5a). */
function openingReason(
  settings: SettingsRecord,
  opening: OpeningPresence | undefined
): string | undefined {
  if (readOpeningFromNothing(settings) || !opening || opening.posted) return undefined
  const { summary } = opening
  if (summary.rows === 0) {
    return (
      'No opening balances yet. Fill them from the connected accounting system, enter them, ' +
      'or declare that the books start from nothing.'
    )
  }
  if (summary.debitMinor !== summary.creditMinor) {
    return (
      `The opening balances are out of balance by ` +
      `${Math.abs(summary.debitMinor - summary.creditMinor)} cents. They have to balance ` +
      'before they can post.'
    )
  }
  return undefined
}

/**
 * Resolve every setup requirement. Every key here is a goal in
 * `ACCOUNTING_GOAL_KEYS`; the two lists must stay in step.
 */
export function resolveSetupReadiness(
  settings: SettingsRecord,
  context: SetupReadinessContext = {}
): SetupReadiness {
  const K = OPENING_BASELINE_SETTING_KEYS

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

  const opening = openingReason(settings, context.opening)

  const requirements: ReadinessRequirement[] = [
    { key: 'set-accounting-period', met: !periodReason, reason: periodReason },
    { key: 'set-opening-balances', met: !opening, reason: opening },
  ]

  return {
    requirements,
    settingsReady: requirements.every((r) => r.met),
    finalized: readSettingText(settings[K.setupState]) === FINALIZED_SETUP_STATE,
  }
}

/**
 * Connections that are following the org default on a role the org has ALREADY
 * split (task 47 §8).
 *
 * > Amazon US has no revenue account of its own. Sales from this connection post
 * > to 4000 Product Revenue.
 *
 * 🛑 **Only once a role carries at least one override.** An org that has never
 * scoped anything is not misconfigured - it is the ordinary org, and warning it
 * that three roles are unscoped on its one store would put a sentence on every
 * row of a finished setup. The interesting state is the HALF-SPLIT one: somebody
 * gave one storefront its own revenue account and left another on the shared
 * one, which is a decision nobody made and which no report can distinguish from
 * one that was.
 *
 * ⚠️ This is the thing Synder does NOT do, and it is worth being better at:
 * their role map advertises a `Sales` account that receives zero postings while
 * every sale credits `Shopify sales`, and nothing in their API exposes why. Our
 * fallback is data, so we can name the account a connection is actually using.
 *
 * Per `feedback_no_internal_jargon_in_ui_strings` the copy says "connection" and
 * "account", never "role scope", "sentinel" or "source account id".
 *
 * PURE. The caller holds both lists already - they arrive on one `ledger.roleMap`
 * read - so this adds no query.
 */
export function describeUnscopedSources(
  roles: readonly UnscopedSourceRole[],
  sources: readonly UnscopedSourceConnection[]
): UnscopedSourceWarning[] {
  const warnings: UnscopedSourceWarning[] = []
  for (const role of roles) {
    // A role nobody has split has nothing to be inconsistent with, and a role
    // marked unused posts nothing at all.
    if (!role.axis || role.overrides.length === 0) continue
    const scoped = new Set(role.overrides)
    for (const source of sources) {
      if (!source.axes.includes(role.axis) || scoped.has(source.id)) continue
      warnings.push({
        role: role.role,
        sourceId: source.id,
        message:
          `${source.name} has no ${role.label.toLowerCase()} account of its own. ` +
          (role.accountLabel
            ? `Sales from this connection post to ${role.accountLabel}.`
            : 'Sales from this connection post to the default account.'),
      })
    }
  }
  return warnings
}

/** One role as {@link describeUnscopedSources} needs it. A subset of `RoleAssignmentRow`. */
export interface UnscopedSourceRole {
  role: string
  /** `ACCOUNT_ROLE_LABELS[role]`. Passed in so this file stays free of the role table. */
  label: string
  /** `'store' | 'rail' | null`. Null is a role that cannot be scoped at all. */
  axis: 'store' | 'rail' | null
  /** The account the role itself names, already formatted, or null when unmapped. */
  accountLabel: string | null
  /** The `FinancialSourceAccount` ids that already carry an override. */
  overrides: readonly string[]
}

/** One connection as {@link describeUnscopedSources} needs it. A subset of `RoleSourceRow`. */
export interface UnscopedSourceConnection {
  id: string
  name: string
  axes: readonly ('store' | 'rail')[]
}

/** One advisory sentence, addressed to one connection on one role. */
export interface UnscopedSourceWarning {
  role: string
  sourceId: string
  message: string
}

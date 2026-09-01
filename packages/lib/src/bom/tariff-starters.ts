// packages/lib/src/bom/tariff-starters.ts

/**
 * The tariff starter catalogue - a small, hand-kept set of government actions and
 * list memberships that expand into a `tariff_code`'s dated rate history
 * (plans/money/tasks/32-tariff-starter-catalogue.md §1).
 *
 * PURE DATA, no io - the same footing as `postings/default-chart.ts`, and for the
 * same reason: `bom/` already owns `TariffRateRow` and `resolveTariffRate`, so the
 * data those map onto belongs beside them.
 *
 * Per task 32 §1.4 the catalogue has two halves with two owners: the generated,
 * checked-in `tariff-hts-general.ts` (not built by this file) carries the MFN
 * general rate for every HTS line; `TARIFF_ACTIONS` and `TARIFF_MEMBERSHIPS` below
 * are hand-kept, because the Section 301 lists, the IEEPA and reciprocal actions,
 * and their Chapter 99 headings are the expensive-to-research half.
 *
 * 🛑 **The 2025 and 2026 rows below are ILLUSTRATIVE and UNVERIFIED.** They must be
 * checked against CBP's CSMS messages and the HTSUS revision in force before a
 * release - see the `// VERIFY` comment on every 2025+ step. The 2026 litigation
 * outcome for the IEEPA actions, and any Section 122 replacement, are deliberately
 * NOT recorded here yet, pending verification.
 *
 * 🛑 **Section 232 is excluded by design, not by omission.** A Section 232 steel or
 * aluminium derivative's duty applies to the metal content value, not the full
 * customs value, and `rate` here is a single percentage of the whole line -
 * task 29 §10 already excludes this and this catalogue does not attempt it.
 */

import type { HtsGeneralLine } from './tariff-hts-general'

/** Bumped on every edit. Stamped into the note of every row the catalogue writes. */
export const TARIFF_STARTERS_VERSION = '2026-09-01'

/**
 * The placeholder `effectiveFrom` stamped on every MFN base row.
 *
 * The HTSUS general rate has carried this date in every fixture so far,
 * including the seed script. It is a placeholder for "as long as anyone cares",
 * not a researched per-code date.
 */
export const MFN_EFFECTIVE_FROM = '1995-01-01'

/**
 * `[effectiveFrom, ratePercent]`. Same rule as `tariff_rate`: every step is
 * dated, an expiry is an explicit `0`, and there is no end date.
 */
export type StarterStep = readonly [from: string, rate: number]

/** One government action, carrying the origin it applies to and its dated steps. */
export interface StarterAction {
  /**
   * Written to `tariff_rate.authority` verbatim. The resolver sums one row per
   * authority, so no two actions for the SAME country may share this string -
   * the same string reused for two different countries is fine (`IEEPA
   * reciprocal` exists for both `CN` and `VN`).
   */
  authority: string
  /** ISO-2 origin this action applies to. */
  country: string
  /**
   * Written to `tariff_rate.chapter99Code`. Required: a base row never has one,
   * an action always does - task 29 §3's "no base rate" warning keys on exactly
   * that.
   */
  chapter99Code: string
  /**
   * `'all'`: every code from `country`. `'listed'`: only codes with a
   * `TARIFF_MEMBERSHIPS` entry naming this key.
   */
  covers: 'all' | 'listed'
  steps: readonly StarterStep[]
  /** A Federal Register cite or similar. Appended to the row note when present. */
  note?: string
}

/**
 * The hand-kept government actions.
 *
 * 🛑 **Every 2025+ step is illustrative and unverified** - see the file header.
 * Verify each against CBP's CSMS messages and the Federal Register before a
 * release.
 */
export const TARIFF_ACTIONS = {
  '301-1': {
    authority: 'Section 301 List 1',
    country: 'CN',
    chapter99Code: '9903.88.01',
    covers: 'listed',
    steps: [['2018-07-06', 25]],
    note: '83 FR 28710',
  },
  '301-2': {
    authority: 'Section 301 List 2',
    country: 'CN',
    chapter99Code: '9903.88.02',
    covers: 'listed',
    steps: [['2018-08-23', 25]],
    note: '83 FR 40823',
  },
  '301-3': {
    authority: 'Section 301 List 3',
    country: 'CN',
    chapter99Code: '9903.88.03',
    covers: 'listed',
    steps: [
      ['2018-09-24', 10],
      ['2019-05-10', 25],
    ],
    note: '84 FR 20459',
  },
  '301-4a': {
    authority: 'Section 301 List 4A',
    country: 'CN',
    chapter99Code: '9903.88.15',
    covers: 'listed',
    steps: [
      ['2019-09-01', 15],
      ['2020-02-14', 7.5],
    ],
  },
  'ieepa-fentanyl-cn': {
    authority: 'IEEPA fentanyl',
    country: 'CN',
    chapter99Code: '9903.01.24',
    covers: 'all',
    steps: [
      ['2025-02-04', 10], // VERIFY
      ['2025-03-04', 20], // VERIFY
      ['2025-11-10', 10], // VERIFY
    ],
  },
  'ieepa-reciprocal-cn': {
    authority: 'IEEPA reciprocal',
    country: 'CN',
    chapter99Code: '9903.01.25',
    covers: 'all',
    steps: [
      ['2025-04-05', 10], // VERIFY
      ['2025-04-09', 125], // VERIFY
      ['2025-05-14', 10], // VERIFY
    ],
  },
  'ieepa-reciprocal-vn': {
    authority: 'IEEPA reciprocal',
    country: 'VN',
    chapter99Code: '9903.01.25',
    covers: 'all',
    steps: [
      ['2025-04-05', 10], // VERIFY
      ['2025-08-07', 20], // VERIFY
    ],
  },
} as const satisfies Record<string, StarterAction>

/** A key into {@link TARIFF_ACTIONS}. */
export type ActionKey = keyof typeof TARIFF_ACTIONS

/**
 * Section 301 list membership, keyed at the level USTR publishes its annexes -
 * an 8-digit `NNNN.NN.NN` or a 6-digit `NNNN.NN` prefix. One entry covers every
 * 10-digit suffix under it.
 *
 * 🛑 **Every entry below is illustrative and unverified** - see the file header.
 * Verify each against the USTR annex before a release.
 */
export const TARIFF_MEMBERSHIPS: Record<string, readonly ActionKey[]> = {
  '8481.80': ['301-3'], // VERIFY
  '7318.15': ['301-1'], // VERIFY
  '8536.50': ['301-3'], // VERIFY
  '8501.10': ['301-4a'], // VERIFY
  '8544.42': ['301-3'], // VERIFY
  '7326.90': ['301-3'], // VERIFY
}

/** One dated row the expander produces, ready to map onto a `TariffRateRow`. */
export interface StarterRow {
  authority: string | null
  rate: number
  /** `YYYY-MM-DD`. */
  effectiveFrom: string
  chapter99Code: string | null
  note: string
}

/** One catalogue code, expanded for one country of origin. */
export interface StarterExpansion {
  code: string
  description: string
  rows: StarterRow[]
  /**
   * `true`: a membership was found for this code and origin. `false`: the
   * origin has at least one `'listed'` action and none names this code - the
   * schedule is understated by exactly that rate and nothing else warns, so
   * this must be rendered. `null`: the origin has no `'listed'` action at all,
   * so the question does not arise.
   */
  membershipRecorded: boolean | null
}

/**
 * The provenance sentence stamped on every row the catalogue writes.
 *
 * It is the provenance, the disclaimer, and what a later sync would grep for,
 * all in one field that already exists on `tariff_rate`.
 */
export function starterNote(version: string = TARIFF_STARTERS_VERSION): string {
  return `From the auxx tariff catalogue (${version}). Verify against your broker's entry summary.`
}

/**
 * The `TARIFF_MEMBERSHIPS` keys that could apply to a 10-digit (or shorter) HTS
 * `code`: the code is normalized to digits only, then looked up first at the
 * 8-digit `NNNN.NN.NN` prefix, then at the 6-digit `NNNN.NN` prefix. The first
 * hit wins; an unmatched code returns an empty list.
 */
export function membershipsFor(
  code: string,
  memberships: Record<string, readonly ActionKey[]> = TARIFF_MEMBERSHIPS
): readonly ActionKey[] {
  const digits = code.replace(/\D/g, '')

  if (digits.length >= 8) {
    const eightDigit = `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`
    const hit = memberships[eightDigit]
    if (hit) return hit
  }

  if (digits.length >= 6) {
    const sixDigit = `${digits.slice(0, 4)}.${digits.slice(4, 6)}`
    const hit = memberships[sixDigit]
    if (hit) return hit
  }

  return []
}

/**
 * Expands one generated HTS line into its full starter schedule for one country
 * of origin: the MFN base row, plus one row per step of every action whose
 * origin matches and which either covers every code or names this one.
 *
 * Pure - no io, no `Date.now`, no imports beyond {@link HtsGeneralLine}'s type
 * and nothing from `@auxx/*`. Callable from the browser and the server alike.
 *
 * @param line `[code, ratePercent, description]` from the generated general-rate
 *   table.
 * @param country ISO-2 origin to expand the schedule for.
 * @param deps Override the hand-kept tables and the stamped version - used by
 *   tests; production callers omit this.
 */
export function expandTariffStarter(
  line: HtsGeneralLine,
  country: string,
  deps?: {
    actions?: Record<string, StarterAction>
    memberships?: Record<string, readonly ActionKey[]>
    version?: string
  }
): StarterExpansion {
  const actions = deps?.actions ?? TARIFF_ACTIONS
  const memberships = deps?.memberships ?? TARIFF_MEMBERSHIPS
  const version = deps?.version ?? TARIFF_STARTERS_VERSION

  const [code, mfnRate, description] = line

  const originHasListedAction = Object.values(actions).some(
    (action) => action.country === country && action.covers === 'listed'
  )
  const codeMemberships = membershipsFor(code, memberships)
  const membershipRecorded = originHasListedAction
    ? codeMemberships.some((key) => actions[key]?.country === country)
    : null

  const rows: StarterRow[] = [
    {
      authority: null,
      rate: mfnRate,
      effectiveFrom: MFN_EFFECTIVE_FROM,
      chapter99Code: null,
      note:
        starterNote(version) +
        (membershipRecorded === false ? ' Section 301 membership not recorded for this code.' : ''),
    },
  ]

  for (const [key, action] of Object.entries(actions)) {
    if (action.country !== country) continue
    if (action.covers !== 'all' && !codeMemberships.includes(key as ActionKey)) continue

    const note = starterNote(version) + (action.note ? ` ${action.note}` : '')
    for (const [from, rate] of action.steps) {
      rows.push({
        authority: action.authority,
        rate,
        effectiveFrom: from,
        chapter99Code: action.chapter99Code,
        note,
      })
    }
  }

  return { code, description, rows, membershipRecorded }
}

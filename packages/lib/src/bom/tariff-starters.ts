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
 * Per task 32 §1.4 the catalogue has a generated half and a hand-kept half. TWO
 * of the three tables are now generated: `tariff-hts-general.ts` carries the MFN
 * general rate for every HTS line, and `tariff-301-memberships.ts` carries
 * Section 301 list membership for every 8-digit subheading (moved out of this
 * file on 2026-09-01 - its header records why, and which three of the six
 * hand-kept entries were wrong).
 *
 * What is left hand-kept here is `TARIFF_ACTIONS` alone: a dozen or two
 * government actions with their dated steps and Chapter 99 headings. That is
 * genuinely research, it is small, and it is where all the editing happens.
 *
 * ✅ **Every action's CURRENT rate was checked against the live HTSUS on
 * 2026-09-01** via the USITC export the generated half already comes from
 * (`exportList?from=9903.01&to=9903.02` and `from=9903.88&to=9903.89`). All six
 * matched. Those steps carry `// checked 2026-09-01` below.
 *
 * 🛑🛑 **THE TWO IEEPA ACTIONS MAY NOT BE IN FORCE AT ALL. UNRESOLVED as of
 * 2026-09-01, and the two authorities that should answer it DISAGREE.**
 *
 *  - **The HTSUS says they are live.** Chapter 99 Revision 17 (2026), pulled
 *    2026-09-01, states `9903.01.24` and `9903.01.25` at "+ 10%" with no
 *    termination. The schedule DOES mark terminations when they happen -
 *    `9903.01.64`-`.76` are marked terminated as of 2025-08-07 and
 *    `9903.85.69`-`.72` as of 2026-04-06 - so the absence of a marker here is
 *    meaningful, not an oversight of the format. It also carries no Section 122
 *    provision anywhere.
 *  - **Secondary sources say they are dead.** Multiple law firms report the
 *    Supreme Court held on 2026-02-20 that IEEPA does not authorize tariffs,
 *    that the President then terminated IEEPA collection and imposed a Section
 *    122 global tariff from 2026-02-24, and that Section 122's own 150-day
 *    statutory limit ran out on 2026-07-24.
 *
 * If the second account is right, **every China row below is 20 points too high
 * today** and both actions need a dated `0` step - which is exactly what the
 * "an expiry is an explicit 0" rule exists for. Do NOT make that change from a
 * blog post: confirm what CBP is actually collecting, then record it.
 *
 * ✅ **Section 301 is unaffected either way** - every source agrees the
 * SCOTUS ruling reached IEEPA alone. The list rates and the generated
 * memberships stand.
 *
 * ⚠️ Whichever way this lands, task 29 §5 bounds the damage: duty lives in lane
 * B only, so a wrong IEEPA row mis-estimates `part_cost` and the PO chip and
 * never values a movement.
 *
 * 🛑 **The HISTORICAL steps are still ILLUSTRATIVE and UNVERIFIED** - the HTSUS
 * states only the rate in force, so the dated path to it has to come from CBP's
 * CSMS messages and the Federal Register. Every unconfirmed step keeps its
 * `// VERIFY`. The 2026 litigation outcome for the IEEPA actions, and any Section
 * 122 replacement, are deliberately NOT recorded here yet.
 *
 * ⚠️ **The 2024 four-year-review action is NOT modelled.** Chapter 99 headings
 * 9903.91.01-9903.91.16 add product-specific China increases of +25/+50/+100%
 * ON TOP of the List rates, phased in on 2024-09-27, 2025-01-01, 2026-01-01 and
 * 2026-11-10. They are `covers: 'listed'` in this model's terms, but the code
 * lists live in U.S. note 31 to subchapter III and have not been transcribed, so
 * a code in one of those sectors (EVs, batteries, semiconductors, solar cells,
 * critical minerals, medical products, cranes) is understated here by that
 * action's rate with nothing warning about it - `membershipRecorded` only knows
 * about the Section 301 lists.
 *
 * 🛑 **Section 232 is excluded by design, not by omission.** A Section 232 steel or
 * aluminium derivative's duty applies to the metal content value, not the full
 * customs value, and `rate` here is a single percentage of the whole line -
 * task 29 §10 already excludes this and this catalogue does not attempt it.
 */

import type { TariffMemberships } from './tariff-301-memberships'
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
    // HTSUS: "The duty provided in the applicable subheading + 25%" - checked 2026-09-01
    steps: [['2018-07-06', 25]],
    note: '83 FR 28710',
  },
  '301-2': {
    authority: 'Section 301 List 2',
    country: 'CN',
    chapter99Code: '9903.88.02',
    covers: 'listed',
    // HTSUS: "The duty provided in the applicable subheading + 25%" - checked 2026-09-01
    steps: [['2018-08-23', 25]],
    note: '83 FR 40823',
  },
  '301-3': {
    authority: 'Section 301 List 3',
    country: 'CN',
    chapter99Code: '9903.88.03',
    covers: 'listed',
    // HTSUS: "The duty provided in the applicable subheading + 25%" - checked
    // 2026-09-01. List 3 has NOT moved off 25%; the 2024 four-year review put
    // its increases in the separate 9903.91 headings (see the file header).
    steps: [
      ['2018-09-24', 10],
      ['2019-05-10', 25], // checked 2026-09-01
    ],
    note: '84 FR 20459',
  },
  '301-4a': {
    authority: 'Section 301 List 4A',
    country: 'CN',
    chapter99Code: '9903.88.15',
    covers: 'listed',
    // HTSUS: "The duty provided in the applicable subheading + 7.5%" - checked 2026-09-01
    steps: [
      ['2019-09-01', 15],
      ['2020-02-14', 7.5], // checked 2026-09-01
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
      ['2025-11-10', 10], // checked 2026-09-01: 9903.01.24 is "+ 10%"
    ],
  },
  'ieepa-reciprocal-cn': {
    authority: 'IEEPA reciprocal',
    country: 'CN',
    // China has no heading of its own in the 9903.02 range - it sits on the
    // origin-agnostic 10% baseline. Checked 2026-09-01.
    chapter99Code: '9903.01.25',
    covers: 'all',
    steps: [
      ['2025-04-05', 10], // VERIFY
      ['2025-04-09', 125], // VERIFY
      ['2025-05-14', 10], // checked 2026-09-01: 9903.01.25 is "+ 10%"
    ],
  },
  'ieepa-reciprocal-vn': {
    authority: 'IEEPA reciprocal',
    country: 'VN',
    // ⚠️ Was `9903.01.25`, which is WRONG for Vietnam's current rate: that
    // heading is the origin-agnostic 10% baseline, and Vietnam's 20% moved to
    // its own heading on 2025-08-07. A `StarterAction` carries ONE heading for
    // every step, so it names the one in force - a broker reading 20% against
    // 9903.01.25 would be reading a heading that does not state 20%.
    // HTSUS: "The duty provided in the applicable subheading + 20%" - checked 2026-09-01
    chapter99Code: '9903.02.69',
    covers: 'all',
    steps: [
      ['2025-04-05', 10], // VERIFY - under 9903.01.25 at the time
      ['2025-08-07', 20], // checked 2026-09-01: 9903.02.69 is "+ 20%"
    ],
  },
} as const satisfies Record<string, StarterAction>

/** A key into {@link TARIFF_ACTIONS}. */
export type ActionKey = keyof typeof TARIFF_ACTIONS

/**
 * 🛑 **`TARIFF_MEMBERSHIPS` is gone.** Section 301 list membership is now
 * GENERATED, in `tariff-301-memberships.ts` / `.json`, straight from U.S. note
 * 20 to subchapter III — see that module's header for why, and for the three
 * wrong entries the hand-kept version of this table shipped with.
 *
 * The consequence for this file: `membershipsFor` and `expandTariffStarter`
 * take the table as an ARGUMENT and have no default. That is deliberate. A
 * default would have to name the generated module, which would drag ~10,000
 * subheadings into `bom/client.ts`'s bundle the moment anything client-side
 * imported the expander. Injecting it keeps both functions pure and
 * client-safe, and puts the load on the server callers that already `await`
 * `loadHtsGeneral`.
 */

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
export function membershipsFor(code: string, memberships: TariffMemberships): readonly ActionKey[] {
  const digits = code.replace(/\D/g, '')

  if (digits.length >= 8) {
    const eightDigit = `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`
    const hit = memberships[eightDigit]
    if (hit) return hit as readonly ActionKey[]
  }

  // The 6-digit fallback is kept for a hand-supplied table (a test, or a list
  // published at heading level). The generated table is 8-digit throughout.
  if (digits.length >= 6) {
    const sixDigit = `${digits.slice(0, 4)}.${digits.slice(4, 6)}`
    const hit = memberships[sixDigit]
    if (hit) return hit as readonly ActionKey[]
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
 * @param memberships The generated Section 301 table, from
 *   `loadTariffMemberships()`. Required, and injected rather than defaulted -
 *   see the note where `TARIFF_MEMBERSHIPS` used to be.
 * @param deps Override the hand-kept action table and the stamped version -
 *   used by tests; production callers omit this.
 */
export function expandTariffStarter(
  line: HtsGeneralLine,
  country: string,
  memberships: TariffMemberships,
  deps?: {
    actions?: Record<string, StarterAction>
    version?: string
  }
): StarterExpansion {
  const actions = deps?.actions ?? TARIFF_ACTIONS
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

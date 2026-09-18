// packages/lib/src/inventory/tariffs/tariff-starters.ts

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
 * ✅ **Section 232 IS modelled, as of 2026-09-18** - see `'232-metal'` below and
 * `tariff-232-derivatives.ts`. It was excluded for two years on the premise that
 * the duty "applies to the metal content value, not the full customs value", so
 * a single percentage could not express it. **U.S. note 16(c) says the
 * opposite**: headings 9903.82.02-9903.82.26 "apply to the full customs value".
 * The premise was a reasonable inference and it was wrong; 29 §10's entry for it
 * is superseded. What note 16(c) really gates on is enumeration, plus - outside
 * chapters 72/73/74/76 - a 15%-by-weight test, and no code in scope is outside
 * those chapters today.
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
  /**
   * How a step's number becomes a duty.
   *
   * `'flat'` (the default): the number IS the additional duty.
   * `'topUpTo'`: the duty is `max(0, number - mfnRate)` - the schedule writes
   * this as two mutually exclusive headings split on the code's column 1 rate,
   * and both branches are that one expression. See `tariff-note52-actions.ts`.
   */
  rateBasis?: 'flat' | 'topUpTo'
  /**
   * Action keys whose coverage of a code suppresses this action for that code.
   *
   * Note 52(f) is the case: its duties do not apply to a code already dutiable
   * under Section 232. Declarative so the carve-out lives in the data rather
   * than as a branch in the expander.
   */
  excludedBy?: readonly string[]
  /** The heading to stamp when `'topUpTo'` computes 0 - the schedule's other half. */
  chapter99CodeWhenZero?: string
  /** A Federal Register cite or similar. Appended to the row note when present. */
  note?: string
}

/**
 * `country` value for an action that applies on the ARTICLE, not the origin.
 *
 * Section 232 is the case: note 16(c) enumerates codes and says nothing about
 * where they come from, so one action per country is not an option.
 */
export const ORIGIN_AGNOSTIC = '*'

/** Whether `action` reaches goods originating in `country`. */
function appliesToCountry(action: StarterAction, country: string): boolean {
  return action.country === ORIGIN_AGNOSTIC || action.country === country
}

/**
 * The date the two IEEPA actions stop contributing duty.
 *
 * ⚠️ **This is the one number in this file recorded AGAINST the HTSUS.** Revision
 * 19 (2026) still prints `9903.01.24` and `9903.01.25` at "+ 10%" with note 2(u)
 * and note 2(v) intact and NO termination marker - and the compiler demonstrably
 * maintains markers in this range (`9903.01.64`-`.76` terminated 2025-08-07,
 * `9903.01.84`-`.89` terminated 2026-02-07). So the schedule says live.
 *
 * It is recorded as `0` anyway because this file's own standing rule is to record
 * **what CBP is actually collecting**, not what the schedule prints, and the
 * evidence for that is now a CBP Form 7501 rather than a secondary source:
 * `7326.90.8688` / CN, entered value $14,172.00, carrying Section 301 List 3
 * (25%), Section 232 (50%), an exemption claim under note 52 - and NO IEEPA line
 * at all. With both actions at `0` this catalogue resolves that code to **77.90%**,
 * matching the entry's total duty of $11,039.99 exactly.
 *
 * 🛑 Two limits on that evidence, so nobody reads it as settled:
 *  - It is ONE entry, and the filer's declaration - the "Ascertained Duty" box is
 *    blank, so it is unliquidated and still correctable.
 *  - The date below is the reported IEEPA collection cutoff, NOT read off the
 *    entry (whose date we do not have). It post-dates every prior step of both
 *    actions, which is what makes the `0` resolve rather than be superseded; if
 *    the true date is later, the only consequence is that this catalogue
 *    under-estimates historical entries between the two dates.
 *
 * ⚠️ 29 §5 bounds the damage either way: duty lives in lane B, so being wrong here
 * mis-estimates `part_cost` and the PO chip and never values a movement.
 */
export const IEEPA_STOPPED_COLLECTION = '2026-02-24'

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
      ['2026-02-24', 0], // no longer collected - see IEEPA_STOPPED_COLLECTION
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
      ['2026-02-24', 0], // no longer collected - see IEEPA_STOPPED_COLLECTION
    ],
  },
  'ieepa-reciprocal-vn': {
    // 🛑 NOT zeroed at IEEPA_STOPPED_COLLECTION, and that is INCONSISTENT with the
    // two China actions above on purpose: the Form 7501 that justified their `0`
    // is a China entry and says nothing about Vietnam. If IEEPA collection
    // stopped as a statute it stopped here too, and this row is then 20 points
    // too high. TODO(owner): decide from a VN entry or a CSMS message, not from
    // symmetry with the China rows.
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
  '232-metal': {
    authority: 'Section 232 metal and derivative articles',
    // Applies on the article, not the origin - U.S. note 16(c) enumerates codes
    // and names no country.
    country: ORIGIN_AGNOSTIC,
    chapter99Code: '9903.82.02',
    covers: 'listed',
    // HTSUS: "The duty provided in the applicable subheading + 50%" - checked
    // 2026-09-18 against Revision 19, and independently attested by a CBP Form
    // 7501 assessing $7,086.00 on an entered value of $14,172.00. The DATE it
    // reached 50% is attested by neither.
    steps: [
      ['2018-03-23', 25], // VERIFY
      ['2025-06-04', 50], // VERIFY the date only
    ],
    note: 'U.S. note 16(c) - full customs value.',
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
 * subheadings into `inventory/tariffs/client.ts`'s bundle the moment anything client-side
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
 * Every membership key that applies to `code`, across all four key lengths the
 * generated tables use: 10-digit (`7326.90.8688`), 8-digit (`7326.90.86`),
 * 6-digit (`7302.10`) and 4-digit (`7601`). The code is normalized to digits
 * only and each prefix is looked up in turn.
 *
 * 🛑 **Accumulates; does NOT return on the first hit.** It used to, which was
 * correct while 301 was the only table and every key was 8 digits. It is not
 * correct now: `7326.90.86.88` is a Section 232 code at 10 digits AND Section
 * 301 List 3 at 8, so first-hit-wins would drop the 301 duty entirely and
 * understate the code by 25 points - the exact silent-understatement failure
 * 29 §3 exists to prevent.
 *
 * Keys are deduplicated and returned most-specific-first.
 */
export function membershipsFor(code: string, memberships: TariffMemberships): readonly ActionKey[] {
  const digits = code.replace(/\D/g, '')

  const prefixes: string[] = []
  if (digits.length >= 10) {
    prefixes.push(`${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 10)}`)
  }
  if (digits.length >= 8) {
    prefixes.push(`${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`)
  }
  if (digits.length >= 6) prefixes.push(`${digits.slice(0, 4)}.${digits.slice(4, 6)}`)
  if (digits.length >= 4) prefixes.push(digits.slice(0, 4))

  const hits = new Set<string>()
  for (const prefix of prefixes) {
    for (const key of memberships[prefix] ?? []) hits.add(key)
  }
  return [...hits] as readonly ActionKey[]
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

  // 🛑 The tri-state is an ORIGIN question - "this origin has a list and this
  // code is not on it" - so it counts only actions naming this country, never
  // the origin-agnostic ones. Counting `'*'` here would make `null` unreachable
  // and render the Section 301 warning on every code of every origin.
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
    if (!appliesToCountry(action, country)) continue
    if (action.covers !== 'all' && !codeMemberships.includes(key as ActionKey)) continue
    // A carve-out: another action already covers this code and displaces this one.
    if (action.excludedBy?.some((other: string) => codeMemberships.includes(other as ActionKey)))
      continue

    const note = starterNote(version) + (action.note ? ` ${action.note}` : '')
    for (const [from, rate] of action.steps) {
      // `topUpTo` brings the TOTAL to `rate`, so the additional duty is whatever
      // the MFN rate leaves short - and nothing when it already clears it.
      const additional = action.rateBasis === 'topUpTo' ? Math.max(0, rate - mfnRate) : rate
      rows.push({
        authority: action.authority,
        rate: additional,
        effectiveFrom: from,
        chapter99Code:
          additional === 0 && action.chapter99CodeWhenZero
            ? action.chapter99CodeWhenZero
            : action.chapter99Code,
        note,
      })
    }
  }

  return { code, description, rows, membershipRecorded }
}

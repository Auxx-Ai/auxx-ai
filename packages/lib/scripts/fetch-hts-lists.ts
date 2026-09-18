// packages/lib/scripts/fetch-hts-lists.ts
//
// Maintainer's tool for the two GENERATED membership tables of the tariff
// starter catalogue (plans/money/tasks/61-section-232-derivatives.md §2).
//
// Fetches the HTSUS chapter 99 PDF ONCE and reads two different notes out of it:
//
//   U.S. note 20  -> `src/inventory/tariffs/tariff-301-memberships.json`
//                    the four Section 301 list enumerations
//   U.S. note 16  -> `src/inventory/tariffs/tariff-232-derivatives.json`
//                    subdivisions (c)(i)-(v), the lists heading 9903.82.02 covers
//   U.S. note 52  -> `src/inventory/tariffs/tariff-note52-actions.json`
//                    headings 9903.05.20-.84, one additional-duty action per origin
//
//   pnpm --filter @auxx/lib exec tsx scripts/fetch-hts-lists.ts
//
// Requires `pdftotext` (poppler) on PATH - `brew install poppler`. The notes are
// published only as a PDF; every other endpoint on hts.usitc.gov returns the
// schedule rows, whose `footnotes` and `additionalDuties` fields are empty for
// Section 301 (checked 2026-09-01).
//
// 🛑 The two notes spell codes DIFFERENTLY and each extraction carries its own
// pair of regexes because of it. Note 20 is uniformly 8-digit; note 16(c) mixes
// 4-, 6-, 8- and 10-digit (`7601`, `7302.10`, `7216.10.00`, `7326.90.8688`).
// Widening note 20's pattern to cover note 16 would let a line of bare 4-digit
// headings inside note 20's narrative match `TABLE_ROW`, so the strict pattern
// stays where it is. Do not unify them.
//
// 🛑 Never edited by hand, and never imported at runtime by anything that
// reaches the browser - see each loader's header.
//
// Expect ~10,000 subheadings across the four 301 lists and a few hundred codes
// across the five note 16 lists; a couple of hundred KB written in total. Both
// outputs are one line per code so a re-run's diff is reviewable per code.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ISO_COUNTRY_OPTIONS } from '../src/resources/registry/iso-country-options'

const SOURCE_URL =
  'https://hts.usitc.gov/reststop/file?release=currentRelease&filename=Chapter%2099'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_301 = path.join(scriptDir, '../src/inventory/tariffs/tariff-301-memberships.json')
const OUTPUT_232 = path.join(scriptDir, '../src/inventory/tariffs/tariff-232-derivatives.json')
const OUTPUT_NOTE52 = path.join(scriptDir, '../src/inventory/tariffs/tariff-note52-actions.json')

/** The single `TARIFF_ACTIONS` key every note 16(c)(i)-(v) list feeds. */
const KEY_232 = '232-metal'

/**
 * ⚠️ **An assumption, not an extraction.** U.S. note 52 carries no effective date
 * in its own text, so the one stamped on every note 52 step is supplied here.
 * It is set to the date IEEPA collection is understood to have stopped, on the
 * reading that note 52 is its replacement - see `IEEPA_STOPPED_COLLECTION` in
 * `inventory/tariffs/tariff-starters.ts` for the evidence and its limits.
 * If the true date is later, this over-estimates entries between the two dates.
 */
const NOTE_52_EFFECTIVE_FROM = '2026-02-24'

/**
 * Chapters where note 16(c) applies unconditionally. Outside them the heading
 * "only appl[ies] where the weight of the applicable metal is at least 15
 * percent of the weight of the imported article" - a per-article physical fact
 * this catalogue cannot know, so those codes are reported separately and are
 * NOT emitted as memberships.
 */
const UNCONDITIONAL_CHAPTERS = new Set(['72', '73', '74', '76'])

/**
 * The four enumerations, keyed by the `TARIFF_ACTIONS` key they feed.
 *
 * Each is located by the sentence that OPENS its subdivision, not by a line
 * number or a subdivision letter: the letters have been reused as the note
 * grew (subdivision (s) is List 4A here but (s) of note 2 is an aluminium
 * rule), and line numbers move on every revision. The heading number in the
 * sentence is the stable part.
 */
const LIST_OPENERS: ReadonlyArray<{ key: string; heading: string; opener: RegExp }> = [
  {
    key: '301-1',
    heading: '9903.88.01',
    opener: /Heading\s+9903\.88\.01\s+applies\s+to\s+all\s+products\s+of\s+China/i,
  },
  {
    key: '301-2',
    heading: '9903.88.02',
    opener: /Heading\s+9903\.88\.02\s+applies\s+to\s+all\s+products\s+of\s+China/i,
  },
  {
    key: '301-3',
    heading: '9903.88.03',
    opener: /Heading\s+9903\.88\.03\s+applies\s+to\s+all\s+products\s+of\s+China/i,
  },
  { key: '301-4a', heading: '9903.88.15', opener: /Heading\s+9903\.88\.15\s+applies\s+to:/i },
]

/** A subdivision marker — `(a)`, `(ii)`, `(bb)` — at the start of a line. */
const SUBDIVISION = /^\s{0,30}\([a-z]{1,3}\)\s/

/**
 * A row of the enumeration table: nothing but 8-digit codes and whitespace.
 *
 * 🛑 This is the whole precision of the extractor and it is not cosmetic.
 * Subdivision (s) ends in narrative paragraphs that EXCLUDE products, quoting
 * real subheadings (`9401.71.00`, `6307.90.98`) and 10-digit statistical
 * numbers. Matching codes anywhere in the range would enrol every one of those
 * exclusions as a member — the exact inversion of what the note says. Only a
 * line that is entirely codes is a membership row.
 */
const TABLE_ROW = /^(?:\s*\d{4}\.\d{2}\.\d{2})+\s*$/

const CODE = /\b(\d{4}\.\d{2}\.\d{2})\b/g

export interface ListExtraction {
  key: string
  heading: string
  /** 8-digit subheadings, ascending, deduplicated. */
  codes: string[]
  /** How many table rows the codes came from — a sanity number for the log. */
  rows: number
}

/**
 * Pulls one list's 8-digit subheadings out of the extracted chapter 99 text.
 *
 * The subdivision runs from its opening sentence to the next subdivision
 * marker at the same or shallower nesting, which is how the note is laid out.
 * Codes in chapters 98 and 99 are dropped: a cross-reference to another
 * Chapter 99 heading is prose, never a membership, and one appearing inside a
 * code table would be a parse error worth failing on rather than emitting.
 */
export function extractList(
  lines: readonly string[],
  opener: RegExp,
  key: string,
  heading: string
): ListExtraction {
  const start = lines.findIndex((line) => opener.test(line))
  if (start === -1) {
    throw new Error(`Could not find the opening sentence for ${key} (${heading}) in chapter 99`)
  }

  const codes = new Set<string>()
  let rows = 0
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // The next list's opener also ends this one: the enumerations are adjacent
    // and a stray subdivision marker inside a table would otherwise stop it early.
    if (LIST_OPENERS.some((entry) => entry.key !== key && entry.opener.test(line))) break
    if (!TABLE_ROW.test(line) || line.trim() === '') {
      // A subdivision marker after we have started collecting means the table
      // is over. Before that, it is the `(i)` that introduces List 4A's table.
      if (SUBDIVISION.test(line) && codes.size > 0) break
      continue
    }
    rows++
    for (const match of line.matchAll(CODE)) {
      const code = match[1] ?? ''
      if (code.startsWith('98') || code.startsWith('99')) {
        throw new Error(`${key}: chapter ${code.slice(0, 2)} code ${code} inside a table row`)
      }
      codes.add(code)
    }
  }

  if (codes.size === 0) throw new Error(`${key} (${heading}) extracted zero subheadings`)
  return { key, heading, codes: [...codes].sort(), rows }
}

/** `{ '8481.80.90': ['301-3'] }` — one entry per subheading, ascending. */
export function invertToMemberships(
  extractions: readonly ListExtraction[]
): Record<string, string[]> {
  const byCode = new Map<string, string[]>()
  for (const extraction of extractions) {
    for (const code of extraction.codes) {
      const held = byCode.get(code)
      if (held) held.push(extraction.key)
      else byCode.set(code, [extraction.key])
    }
  }
  const out: Record<string, string[]> = {}
  for (const code of [...byCode.keys()].sort()) out[code] = byCode.get(code) ?? []
  return out
}

/* ══════════════════════════════════════════════════════════════════════════
   U.S. note 16(c) - the Section 232 metal and derivative lists
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Note 16(c)'s subdivision (i), which is where the enumeration starts.
 *
 * Located by the sentence opening subdivision (c) rather than by "16." at the
 * start of a line: the notes are numbered in a running sequence that renumbers
 * between revisions, and this sentence carries the heading range instead.
 */
const NOTE_16C_OPENER =
  /Headings\s+9903\.82\.02[-–]9903\.82\.26\s+apply\s+to\s+the\s+full\s+customs\s+value/i

/**
 * 🛑 Only (i) through (v) are in scope. `9903.82.02` reads "as provided for in
 * subdivisions (c)(i)–(v) of U.S. note 16"; lists (vi) through (xi) belong to
 * the sibling headings 9903.82.04-9903.82.26, which carry the smelt-and-cast
 * conditions of note 16(e) and are NOT modelled. Stop at (vi).
 */
const NOTE_16C_SUBLIST = /^\s{0,30}\((i|ii|iii|iv|v)\)\s+(?:Articles of|Derivative)/
const NOTE_16C_STOP = /^\s{0,30}\(vi\)\s/

/**
 * A note 16(c) table row: nothing but codes and whitespace.
 *
 * Four spellings appear, and all four are real: `7601` (heading), `7302.10`
 * (subheading), `7216.10.00` (8-digit) and `7326.90.8688` (10-digit, 4-2-4).
 * Same whole-line strictness as {@link TABLE_ROW} and for the same reason - it
 * is what keeps the page furniture ("XXII", "99 - III - 66", the revision
 * banner) and any narrative prose out of the enumeration.
 */
const WIDE_TABLE_ROW = /^(?:\s*\d{4}(?:\.\d{2}(?:\.\d{2,4})?)?)+\s*$/
const WIDE_CODE = /\b(\d{4}(?:\.\d{2}(?:\.\d{2,4})?)?)\b/g

export interface Note16Extraction {
  /** Codes in chapters 72/73/74/76 - the duty applies unconditionally. */
  unconditional: string[]
  /** Codes outside them - applicability turns on a 15%-by-weight test. */
  weightTested: string[]
  /** Per sublist, for the log: `(iii) Articles of steel -> 37`. */
  perList: Array<{ marker: string; count: number }>
}

/**
 * Pulls note 16(c) subdivisions (i)-(v) out of the extracted chapter 99 text and
 * partitions them on {@link UNCONDITIONAL_CHAPTERS}.
 *
 * Exported for tests; `main` is the only production caller.
 */
export function extractNote16(lines: readonly string[]): Note16Extraction {
  const start = lines.findIndex((line) => NOTE_16C_OPENER.test(line))
  if (start === -1) throw new Error('Could not find the opening sentence of U.S. note 16(c)')

  const seen = new Set<string>()
  const perList: Array<{ marker: string; count: number }> = []
  let marker: string | null = null
  let countForList = 0

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (NOTE_16C_STOP.test(line)) break

    const sublist = NOTE_16C_SUBLIST.exec(line)
    if (sublist) {
      if (marker) perList.push({ marker, count: countForList })
      marker = line.trim().replace(/\s+/g, ' ').replace(/:$/, '')
      countForList = 0
      continue
    }
    if (marker === null || !WIDE_TABLE_ROW.test(line) || line.trim() === '') continue

    for (const match of line.matchAll(WIDE_CODE)) {
      const code = match[1] ?? ''
      // A chapter 98 or 99 code inside a code table is a parse error, never a
      // membership - same guard, same reasoning, as the note 20 extractor.
      if (code.startsWith('98') || code.startsWith('99')) {
        throw new Error(`note 16(c): chapter ${code.slice(0, 2)} code ${code} inside a table row`)
      }
      if (!seen.has(code)) countForList++
      seen.add(code)
    }
  }
  if (marker) perList.push({ marker, count: countForList })

  if (seen.size === 0) throw new Error('note 16(c) extracted zero codes')
  if (perList.length !== 5) {
    throw new Error(`note 16(c): expected 5 sublists (i)-(v), found ${perList.length}`)
  }

  const unconditional: string[] = []
  const weightTested: string[] = []
  for (const code of [...seen].sort()) {
    ;(UNCONDITIONAL_CHAPTERS.has(code.slice(0, 2)) ? unconditional : weightTested).push(code)
  }
  return { unconditional, weightTested, perList }
}

/** One line per code, so a re-run's diff is reviewable per code. */
function write232File(filePath: string, fetchedAt: string, extraction: Note16Extraction): void {
  const section = (codes: readonly string[], indent: string): string[] =>
    codes.map(
      (code, index) =>
        `${indent}${JSON.stringify(code)}: ${JSON.stringify([KEY_232])}${index === codes.length - 1 ? '' : ','}`
    )
  const out: string[] = ['{']
  out.push(`  "fetchedAt": ${JSON.stringify(fetchedAt)},`)
  out.push(`  "source": ${JSON.stringify(SOURCE_URL)},`)
  out.push('  "memberships": {')
  out.push(...section(extraction.unconditional, '    '))
  out.push('  },')
  out.push('  "weightTested": {')
  out.push(...section(extraction.weightTested, '    '))
  out.push('  }')
  out.push('}')
  out.push('')
  writeFileSync(filePath, out.join('\n'))
}

/* ══════════════════════════════════════════════════════════════════════════
   U.S. note 52 - headings 9903.05.20-.84, one additional duty per origin
   ══════════════════════════════════════════════════════════════════════════ */

/** A heading row: the code alone, or the code then the start of its description. */
const NOTE_52_HEADING = /^\s*(9903\.05\.\d{2})\s+(?:1\/\s*$|Except|Articles)/

/** `articles the product of <who>, as provided for in U.S. note 52` */
const NOTE_52_WHO = /articles the product of (.+?), as provided for in U\.S\. note 52/

/** The flat case: "The duty provided in the applicable subheading + 12.5%". */
const NOTE_52_FLAT_RATE = /subheading \+\s*([\d.]+)%/

/**
 * The conditional case. Five origins get TWO headings each - one for codes whose
 * column 1 rate is at or above a threshold, one for those below:
 *
 *   9903.05.48  Japan, column 1 rate >= 10 percent .... the duty in the subheading
 *   9903.05.49  Japan, column 1 rate <  10 percent .... 10%
 *
 * ✅ Both branches are the SAME function of the line's own MFN rate:
 * `max(0, 10 - mfn)`. At or above the threshold that is 0, below it it tops the
 * total up to the threshold. So the two headings collapse into ONE action with
 * `rateBasis: 'topUpTo'`, and no new concept reaches `resolveTariffRate` - the
 * row it writes is an ordinary flat percentage, just a computed one.
 */
const NOTE_52_CONDITIONAL =
  /rate of duty under column 1 (equal to or greater than|less than) (\d+(?:\.\d+)?) percent/

/** ISO-2 for the names note 52 uses that are not the CLDR short form. */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  'the Bahamas': 'BS',
  'Hong Kong, China': 'HK',
  'the Philippines': 'PH',
  Türkiye: 'TR',
  'the United Arab Emirates': 'AE',
  'the United Kingdom': 'GB',
  'South Korea': 'KR',
  Taiwan: 'TW',
}

/**
 * 🛑 "a member state of the European Union" is not a country and `tariff_code`
 * is keyed on an ISO-2 origin, so the two EU headings fan out to all 27.
 */
const EU_MEMBER_STATES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
] as const

export interface Note52Action {
  key: string
  authority: string
  country: string
  chapter99Code: string
  /** The heading that applies when the computed duty is 0 (`topUpTo` only). */
  chapter99CodeWhenZero?: string
  covers: 'all'
  rateBasis: 'flat' | 'topUpTo'
  steps: Array<[string, number]>
  excludedBy: string[]
  note: string
}

/**
 * ISO-2 for a note 52 origin name, or `null` for the EU (handled by fan-out).
 *
 * The note writes plain English; the option set carries CLDR short forms, which
 * differ in punctuation more than in wording (`Trinidad and Tobago` vs
 * `Trinidad & Tobago`, `Cote d'Ivoire` vs `Côte d'Ivoire`). Normalizing both
 * sides is what keeps {@link COUNTRY_ALIASES} down to the genuinely different
 * names instead of a transcription of the whole list.
 *
 * Returns `undefined` when nothing matches; the caller collects those and fails
 * once with the full set, so a new revision's renames are fixed in one pass.
 */
function normalizeCountryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019']/g, '')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/[^a-z0-9& ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isoFor(who: string, byLabel: ReadonlyMap<string, string>): string | null | undefined {
  if (/member state of the European Union/i.test(who)) return null
  const bare = who.replace(/,? with an ad valorem[\s\S]*$/i, '').trim()
  return COUNTRY_ALIASES[bare] ?? byLabel.get(normalizeCountryName(bare))
}

/**
 * Pulls headings 9903.05.20-.84 out of the chapter 99 text as one action per
 * origin.
 *
 * `effectiveFrom` is NOT in the note - it carries no date - so it is supplied by
 * the caller and is the one field here that is an assumption rather than an
 * extraction.
 *
 * Exported for tests; `main` is the only production caller.
 */
export function extractNote52(
  lines: readonly string[],
  isoByLabel: ReadonlyMap<string, string>,
  effectiveFrom: string
): Note52Action[] {
  const starts: Array<{ index: number; heading: string }> = []
  lines.forEach((line, index) => {
    const match = NOTE_52_HEADING.exec(line)
    const suffix = match ? Number(match[1]?.slice(-2)) : Number.NaN
    if (match?.[1] && suffix >= 20 && suffix <= 84) starts.push({ index, heading: match[1] })
  })
  if (starts.length === 0) throw new Error('note 52: found no headings in 9903.05.20-.84')

  // country -> the action being assembled; the conditional origins hit twice.
  const byCountry = new Map<string, Note52Action>()
  const unresolved = new Set<string>()
  const add = (country: string, build: (existing?: Note52Action) => Note52Action): void => {
    byCountry.set(country, build(byCountry.get(country)))
  }

  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.index ?? start.index + 14
    const blob = lines
      .slice(start.index, end)
      .map((line) => line.trim())
      .join(' ')
      .replace(/\.{3,}/g, ' ')
      .replace(/\s+/g, ' ')

    const who = NOTE_52_WHO.exec(blob)?.[1]
    if (!who) continue

    const conditional = NOTE_52_CONDITIONAL.exec(blob)
    const flat = NOTE_52_FLAT_RATE.exec(blob)
    const iso = isoFor(who, isoByLabel)
    if (iso === undefined) {
      unresolved.add(who.replace(/,? with an ad valorem[\s\S]*$/i, '').trim())
      continue
    }
    const countries = iso === null ? [...EU_MEMBER_STATES] : [iso]

    for (const country of countries) {
      add(country, (existing) => {
        if (conditional) {
          const threshold = Number(conditional[2])
          const isZeroBranch = conditional[1] !== 'less than'
          return {
            key: `note52-${country.toLowerCase()}`,
            authority: 'HTS note 52 additional duty',
            country,
            chapter99Code: isZeroBranch
              ? (existing?.chapter99Code ?? start.heading)
              : start.heading,
            chapter99CodeWhenZero: isZeroBranch ? start.heading : existing?.chapter99CodeWhenZero,
            covers: 'all',
            rateBasis: 'topUpTo',
            steps: [[effectiveFrom, threshold]],
            excludedBy: ['232-metal'],
            note: 'U.S. note 52 - tops the total up to the threshold.',
          }
        }
        if (!flat) throw new Error(`note 52: ${start.heading} (${who}) has no rate`)
        return {
          key: `note52-${country.toLowerCase()}`,
          authority: 'HTS note 52 additional duty',
          country,
          chapter99Code: start.heading,
          covers: 'all',
          rateBasis: 'flat',
          steps: [[effectiveFrom, Number(flat[1])]],
          excludedBy: ['232-metal'],
          note: 'U.S. note 52.',
        }
      })
    }
  }

  if (unresolved.size > 0) {
    throw new Error(
      `note 52: no ISO-2 country for ${unresolved.size} origin(s): ${[...unresolved].join(', ')}`
    )
  }

  const actions = [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country))
  for (const action of actions) {
    if (action.rateBasis === 'topUpTo' && !action.chapter99CodeWhenZero) {
      throw new Error(`note 52: ${action.country} saw only one of its two conditional headings`)
    }
  }
  return actions
}

/** One line per action, so a re-run's diff is reviewable per origin. */
function writeNote52File(
  filePath: string,
  fetchedAt: string,
  actions: readonly Note52Action[]
): void {
  const out: string[] = ['{']
  out.push(`  "fetchedAt": ${JSON.stringify(fetchedAt)},`)
  out.push(`  "source": ${JSON.stringify(SOURCE_URL)},`)
  out.push('  "actions": [')
  actions.forEach((action, index) => {
    out.push(`    ${JSON.stringify(action)}${index === actions.length - 1 ? '' : ','}`)
  })
  out.push('  ]')
  out.push('}')
  out.push('')
  writeFileSync(filePath, out.join('\n'))
}

/** One line per subheading, so a re-run's diff is reviewable per code. */
function writeMembershipsFile(
  filePath: string,
  fetchedAt: string,
  source: string,
  memberships: Record<string, string[]>
): void {
  const entries = Object.entries(memberships)
  const out: string[] = ['{']
  out.push(`  "fetchedAt": ${JSON.stringify(fetchedAt)},`)
  out.push(`  "source": ${JSON.stringify(source)},`)
  out.push('  "memberships": {')
  entries.forEach(([code, keys], index) => {
    const comma = index === entries.length - 1 ? '' : ','
    out.push(`    ${JSON.stringify(code)}: ${JSON.stringify(keys)}${comma}`)
  })
  out.push('  }')
  out.push('}')
  out.push('')
  writeFileSync(filePath, out.join('\n'))
}

function pdfToText(pdfBytes: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hts301-'))
  const pdfPath = path.join(dir, 'ch99.pdf')
  const txtPath = path.join(dir, 'ch99.txt')
  writeFileSync(pdfPath, pdfBytes)
  try {
    execFileSync('pdftotext', ['-layout', pdfPath, txtPath], { stdio: 'pipe' })
  } catch (error) {
    throw new Error(
      `pdftotext failed — is poppler installed? (brew install poppler)\n${String(error)}`
    )
  }
  return readFileSync(txtPath, 'utf8')
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`)
  const started = Date.now()
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`Chapter 99 fetch failed: ${response.status} ${response.statusText}`)
  }
  const pdfBytes = Buffer.from(await response.arrayBuffer())
  console.log(`Fetched ${pdfBytes.length} bytes in ${Date.now() - started}ms`)

  const lines = pdfToText(pdfBytes).split('\n')
  console.log(`Extracted ${lines.length} lines of text`)

  const extractions = LIST_OPENERS.map((entry) =>
    extractList(lines, entry.opener, entry.key, entry.heading)
  )
  const memberships = invertToMemberships(extractions)

  const note16 = extractNote16(lines)

  // `"CN - China"` -> `"china" => "CN"`, so note 52's prose names resolve to the
  // same closed option set `tariff_code.country` is keyed on.
  const isoByLabel = new Map(
    ISO_COUNTRY_OPTIONS.map((option) => [
      normalizeCountryName(option.label.replace(/^[A-Z]{2}\s+-\s+/, '')),
      option.value,
    ])
  )
  const note52 = extractNote52(lines, isoByLabel, NOTE_52_EFFECTIVE_FROM)

  const fetchedAt = new Date().toISOString().slice(0, 10)
  writeMembershipsFile(OUTPUT_301, fetchedAt, SOURCE_URL, memberships)
  write232File(OUTPUT_232, fetchedAt, note16)
  writeNote52File(OUTPUT_NOTE52, fetchedAt, note52)

  console.log('--- fetch-hts-301-lists summary ---')
  for (const extraction of extractions) {
    console.log(
      `${extraction.key.padEnd(7)} ${extraction.heading}  ` +
        `${String(extraction.codes.length).padStart(5)} subheadings from ${extraction.rows} rows`
    )
  }
  const multi = Object.values(memberships).filter((keys) => keys.length > 1).length
  console.log(`unique subheadings:     ${Object.keys(memberships).length}`)
  console.log(`on more than one list:  ${multi}`)
  console.log(`output path:            ${OUTPUT_301}`)
  console.log(`output bytes:           ${statSync(OUTPUT_301).size}`)

  console.log('--- U.S. note 16(c)(i)-(v) ---')
  for (const entry of note16.perList) {
    console.log(`${String(entry.count).padStart(5)}  ${entry.marker}`)
  }
  console.log(`unconditional (ch. 72/73/74/76): ${note16.unconditional.length}`)
  console.log(`weight-tested (other chapters):  ${note16.weightTested.length}`)
  console.log(`output path:            ${OUTPUT_232}`)
  console.log(`output bytes:           ${statSync(OUTPUT_232).size}`)

  console.log('--- U.S. note 52 ---')
  const flat = note52.filter((action) => action.rateBasis === 'flat')
  const topUp = note52.filter((action) => action.rateBasis === 'topUpTo')
  console.log(`origins:                ${note52.length}`)
  console.log(`  flat rate:            ${flat.length}`)
  console.log(`  top-up to threshold:  ${topUp.length} (${topUp.map((a) => a.country).join(', ')})`)
  console.log(`effectiveFrom (assumed): ${NOTE_52_EFFECTIVE_FROM}`)
  console.log(`output path:            ${OUTPUT_NOTE52}`)
  console.log(`output bytes:           ${statSync(OUTPUT_NOTE52).size}`)
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

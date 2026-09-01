// packages/lib/scripts/fetch-hts-general.ts
//
// Maintainer's tool for the generated half of the tariff starter catalogue
// (plans/money/tasks/32-tariff-starter-catalogue.md §1.4, §9). Fetches the
// USITC's full HTSUS Column 1 general-rate export, walks its indent tree, and
// writes `packages/lib/src/bom/tariff-hts-general.json` as a three-level tree:
// a 4-digit heading, a 6-digit subheading, and the 10-digit lines under it.
// There is no 8-digit level in the output - the rate is set at 8 digits in the
// source, but the lines below a subheading are few, so the 8-digit row's own
// text is folded into whichever of the subheading node or the leaf's short
// description it belongs under instead of getting a tree level of its own.
//
// Drops every line whose rate is specific or compound (a duty the schedule
// cannot express as a percentage - writing `0` for one would be a silent
// undercharge), and drops a heading or subheading node that ends up with zero
// emitted leaves under it (e.g. a heading whose only lines are specific-duty),
// so the tree never opens onto nothing.
//
// Never edited by hand. Rerun on a new HTS revision, commit the diff, and bump
// `TARIFF_STARTERS_VERSION` in `bom/tariff-starters.ts`. The output file is one
// line per node or line entry on purpose, so a re-run's diff is reviewable per
// code.
//
//   pnpm --filter @auxx/lib exec tsx scripts/fetch-hts-general.ts
//
// Expect ~36k rows read, a few thousand nodes and ~17,700 lines emitted, well
// under 2.7 MB written, a couple of seconds end to end.

import { statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL =
  'https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(scriptDir, '../src/bom/tariff-hts-general.json')

/** One row of the USITC export. Many fields are unused here and left untyped. */
export interface RawHtsRow {
  htsno: string
  indent: string
  description: string
  general: string
  [key: string]: unknown
}

/** `[code, description]` for a 4-digit heading or 6-digit subheading node. */
export type FlattenedNode = readonly [code: string, description: string]

/** `[code, ratePercent, shortDescription]`, matching `HtsGeneralLine` in `bom/tariff-hts-general.ts`. */
export type FlattenedLine = readonly [code: string, rate: number, description: string]

export interface FlattenStats {
  rowsRead: number
  tenDigitLines: number
  emitted: number
  emittedFree: number
  emittedPercent: number
  skippedNoRate: number
  skippedSpecificOrCompound: number
  nodesEmitted: number
  nodesSkippedNoLeaves: number
}

export interface FlattenResult {
  nodes: FlattenedNode[]
  lines: FlattenedLine[]
  stats: FlattenStats
}

/**
 * One level of the walk's ancestor stack. The source's `indent` values are
 * not contiguous - a row can jump from indent 3 to indent 5 when it collapses
 * a level the way `8481.80.10` (indent 3) does before `8481.80.10.20`
 * (indent 5) - so the stack is a real push/pop stack keyed on "nearest
 * preceding row with a smaller indent", not an array indexed by `indent`.
 */
interface StackEntry {
  htsno: string
  description: string
  /** The row's own `indent`, kept so the next row knows what to pop. */
  indent: number
  /** Digits-only `htsno`, `''` for an uncoded intermediate row. */
  digits: string
  /** The general rate this level states, or the nearest ancestor's, or `''`. */
  inheritedRate: string
  /** The first 6 digits of whichever ancestor (or this row) first reached 6 or
   *  more coded digits - the subheading this row falls under. `null` above it. */
  subheadingDigits: string | null
  /** This stack's index (at the time of the push) of the row that established
   *  `subheadingDigits` - valid for as long as that entry stays on the stack. */
  subheadingIndex: number | null
}

/** A candidate 4- or 6-digit node, kept only if at least one leaf lands under it. */
interface NodeCandidate {
  code: string
  description: string
  /** The node's own (non-folded) last segment - the leaf fallback for a
   *  6-digit subheading with no chain below it. Meaningless for a heading. */
  lastSegment: string
  /** 4 digits for a heading, 6 for a subheading - the key into `leafCounts`. */
  countKey: string
}

/** Strip everything but digits, the same rule `normalizeHtsCode` uses at read time. */
function digitsOnly(code: string): string {
  return code.replace(/\D/g, '')
}

/** Trailing `:` and surrounding whitespace stripped, internal whitespace collapsed. */
function cleanSegment(segment: string): string {
  const collapsed = segment.replace(/\s+/g, ' ').trim()
  return collapsed.replace(/:\s*$/, '').trim()
}

/** `true` for a segment that is exactly "Other" once cleaned, case-insensitive. */
function isOtherSegment(segment: string): boolean {
  return segment.toLowerCase() === 'other'
}

/**
 * Joins segments with ` / `, capped at `maxLength` characters. The first and
 * last segments are protected - callers use that to keep the lead-in and the
 * final descriptor on screen no matter how deep the chain runs. Over the cap,
 * middle segments are dropped first (nearest the front), one at a time, until
 * only the first and last remain; only then is the last segment itself
 * truncated to fit alongside the first.
 */
export function capDescription(segments: readonly string[], maxLength: number): string {
  const parts = segments.filter((segment) => segment.length > 0)
  if (parts.length === 0) return ''
  if (parts.length === 1) {
    const only = parts[0] ?? ''
    return only.length > maxLength ? only.slice(0, maxLength) : only
  }

  const kept = [...parts]
  let joined = kept.join(' / ')
  while (joined.length > maxLength && kept.length > 2) {
    kept.splice(1, 1)
    joined = kept.join(' / ')
  }
  if (joined.length > maxLength) {
    const first = kept[0] ?? ''
    const last = kept[kept.length - 1] ?? ''
    const budget = maxLength - first.length - ' / '.length
    joined = budget > 0 ? `${first} / ${last.slice(0, budget)}` : first.slice(0, maxLength)
  }
  return joined
}

/**
 * Cut `text` to at most `maxLength` characters on a word boundary, with no
 * trailing space or comma - a heading cut mid-word reads as a typo in a picker.
 */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const cut = text.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const word = lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut
  return word.replace(/[\s,;]+$/, '')
}

/**
 * Cleans each raw `segments` entry, drops a bare "Other" everywhere except the
 * last surviving segment (a run of nested "Other" headings carries no
 * information the lead-in and the final descriptor don't already carry), and
 * caps the join at `maxLength` (see `capDescription`). Used both for a
 * 6-digit subheading node's description (segments = the uncoded rows between
 * the heading and the subheading, then its own text) and for a leaf's short
 * description (segments = the chain strictly below the subheading).
 */
export function buildFoldedDescription(segments: readonly string[], maxLength: number): string {
  const cleaned = segments.map(cleanSegment).filter((segment) => segment.length > 0)
  const lastIndex = cleaned.length - 1
  const filtered = cleaned.filter(
    (segment, index) => index === lastIndex || !isOtherSegment(segment)
  )
  return capDescription(filtered, maxLength)
}

/**
 * Walks the export's indent tree (a row's parent is the nearest preceding row
 * with a smaller indent) and produces the three-level tree: a `[code,
 * description]` node per 4-digit heading and 6-digit subheading, and a
 * `[code, rate, shortDescription]` line per 10-digit statistical suffix whose
 * inherited general rate is `Free` (rate 0) or a plain percentage.
 *
 * There is no 8-digit node: an 8-digit row's own text (the "tariff item"
 * level, e.g. "Of copper") folds into the leaf's short description, not into
 * a tree level of its own, because the source sometimes merges the 6-, 8- and
 * even 10-digit levels onto one physical row (a subheading with a single
 * direct `.00.00` line) and sometimes spreads them across three, and the tree
 * needs the same two levels above the lines either way.
 *
 * A node is emitted only if at least one line lands under it - a heading or
 * subheading whose lines are all specific/compound duty (skipped, never
 * zeroed) would otherwise open onto nothing.
 *
 * Every other 10-digit line - a specific or compound duty, or no stated rate
 * anywhere in its ancestry - is skipped and counted, never zeroed.
 *
 * Pure: no I/O. `main` below is the only caller that touches the network or
 * the filesystem, which is what keeps this testable without a live fetch.
 */
export function flattenHtsRows(rows: readonly RawHtsRow[]): FlattenResult {
  const stack: StackEntry[] = []
  const lines: FlattenedLine[] = []
  const nodeCandidates: NodeCandidate[] = []
  const candidateByKey = new Map<string, NodeCandidate>()
  const leafCounts = new Map<string, number>()

  const stats: FlattenStats = {
    rowsRead: rows.length,
    tenDigitLines: 0,
    emitted: 0,
    emittedFree: 0,
    emittedPercent: 0,
    skippedNoRate: 0,
    skippedSpecificOrCompound: 0,
    nodesEmitted: 0,
    nodesSkippedNoLeaves: 0,
  }

  for (const row of rows) {
    const indent = Number.parseInt(row.indent, 10) || 0
    // Pop back to the nearest preceding row with a smaller indent - that row
    // is this one's parent. A real stack, not an array indexed by `indent`,
    // because `indent` itself can jump (see the `StackEntry` doc comment).
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop()

    const digits = digitsOnly(row.htsno ?? '')
    const ownRate = (row.general ?? '').trim()
    const parent = stack[stack.length - 1]
    const inheritedRate = ownRate || parent?.inheritedRate || ''

    const inheritedSubheadingDigits = parent?.subheadingDigits ?? null
    const inheritedSubheadingIndex = parent?.subheadingIndex ?? null
    const establishesSubheading = inheritedSubheadingDigits === null && digits.length >= 6
    const subheadingDigits = establishesSubheading ? digits.slice(0, 6) : inheritedSubheadingDigits
    // The position this row will occupy once pushed below - valid for every
    // descendant for as long as this entry stays on the stack.
    const subheadingIndex = establishesSubheading ? stack.length : inheritedSubheadingIndex

    const entry: StackEntry = {
      htsno: row.htsno ?? '',
      description: row.description ?? '',
      indent,
      digits,
      inheritedRate,
      subheadingDigits,
      subheadingIndex,
    }

    if (digits.length === 4) {
      const description = truncateAtWord(cleanSegment(entry.description), 120)
      const candidate: NodeCandidate = {
        code: row.htsno,
        description,
        lastSegment: description,
        countKey: digits,
      }
      nodeCandidates.push(candidate)
      candidateByKey.set(candidate.countKey, candidate)
    }

    if (establishesSubheading && subheadingDigits) {
      const headingIndex = stack.findIndex((e) => e.digits.length === 4)
      const intermediates =
        headingIndex === -1
          ? []
          : stack
              .slice(headingIndex + 1)
              .filter((e) => e.digits.length === 0)
              .map((e) => e.description)
      const segments = [...intermediates, entry.description]
      const description = buildFoldedDescription(segments, 160)
      const cleanedSegments = segments.map(cleanSegment).filter((s) => s.length > 0)
      const lastSegment = cleanedSegments[cleanedSegments.length - 1] ?? ''
      const code = `${subheadingDigits.slice(0, 4)}.${subheadingDigits.slice(4, 6)}`
      const candidate: NodeCandidate = {
        code,
        description,
        lastSegment,
        countKey: subheadingDigits,
      }
      nodeCandidates.push(candidate)
      candidateByKey.set(candidate.countKey, candidate)
    }

    stack.push(entry)

    if (digits.length !== 10) continue
    stats.tenDigitLines++

    let rate: number
    if (inheritedRate === 'Free') {
      rate = 0
      stats.emittedFree++
    } else {
      const percentMatch = /^(\d+(?:\.\d+)?)%$/.exec(inheritedRate)
      if (percentMatch) {
        rate = Number(percentMatch[1])
        stats.emittedPercent++
      } else {
        if (inheritedRate === '') stats.skippedNoRate++
        else stats.skippedSpecificOrCompound++
        continue
      }
    }

    // The chain strictly below the subheading: everything after the row that
    // established it, through this leaf itself (already pushed above). Empty
    // when the subheading and the leaf are the same physical row (a
    // subheading with one direct `.00.00` line) - the merged-row case falls
    // back to the subheading node's own last segment below, so the row is
    // never blank.
    const leafIndex = stack.length - 1
    const belowSegments =
      subheadingIndex === leafIndex
        ? []
        : stack.slice((subheadingIndex ?? 0) + 1).map((e) => e.description)
    let shortDescription = buildFoldedDescription(belowSegments, 160)
    if (!shortDescription) {
      shortDescription = subheadingDigits
        ? (candidateByKey.get(subheadingDigits)?.lastSegment ?? '')
        : ''
      if (!shortDescription) shortDescription = cleanSegment(entry.description)
    }

    lines.push([row.htsno, rate, shortDescription])
    stats.emitted++

    const headingDigits = digits.slice(0, 4)
    leafCounts.set(headingDigits, (leafCounts.get(headingDigits) ?? 0) + 1)
    if (subheadingDigits) {
      leafCounts.set(subheadingDigits, (leafCounts.get(subheadingDigits) ?? 0) + 1)
    }
  }

  const nodes: FlattenedNode[] = []
  for (const candidate of nodeCandidates) {
    const count = leafCounts.get(candidate.countKey) ?? 0
    if (count > 0) {
      nodes.push([candidate.code, candidate.description])
      stats.nodesEmitted++
    } else {
      stats.nodesSkippedNoLeaves++
    }
  }

  return { nodes, lines, stats }
}

/**
 * Hand-rolled writer (not `JSON.stringify` on the whole object) so one line
 * holds one entry: a rerun's diff then shows exactly which nodes or codes
 * moved. `nodes` is written before `lines`, matching the on-disk shape.
 */
function writeCatalogueFile(
  filePath: string,
  fetchedAt: string,
  source: string,
  nodes: readonly FlattenedNode[],
  lines: readonly FlattenedLine[]
): void {
  const out: string[] = []
  out.push('{')
  out.push(`  "fetchedAt": ${JSON.stringify(fetchedAt)},`)
  out.push(`  "source": ${JSON.stringify(source)},`)
  out.push('  "nodes": [')
  nodes.forEach((node, index) => {
    const trailingComma = index === nodes.length - 1 ? '' : ','
    out.push(`    ${JSON.stringify(node)}${trailingComma}`)
  })
  out.push('  ],')
  out.push('  "lines": [')
  lines.forEach((line, index) => {
    const trailingComma = index === lines.length - 1 ? '' : ','
    out.push(`    ${JSON.stringify(line)}${trailingComma}`)
  })
  out.push('  ]')
  out.push('}')
  out.push('')
  writeFileSync(filePath, out.join('\n'))
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`)
  const started = Date.now()
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`HTS export fetch failed: ${response.status} ${response.statusText}`)
  }
  const rows = (await response.json()) as RawHtsRow[]
  console.log(`Fetched ${rows.length} rows in ${Date.now() - started}ms`)

  const { nodes, lines, stats } = flattenHtsRows(rows)
  const fetchedAt = new Date().toISOString().slice(0, 10)
  writeCatalogueFile(OUTPUT_PATH, fetchedAt, SOURCE_URL, nodes, lines)
  const outputBytes = statSync(OUTPUT_PATH).size

  console.log('--- fetch-hts-general summary ---')
  console.log(`rows read:              ${stats.rowsRead}`)
  console.log(`nodes emitted:          ${stats.nodesEmitted}`)
  console.log(`nodes skipped (empty):  ${stats.nodesSkippedNoLeaves}`)
  console.log(`10-digit lines:         ${stats.tenDigitLines}`)
  console.log(`emitted:                ${stats.emitted}`)
  console.log(`  free (0%):            ${stats.emittedFree}`)
  console.log(`  percent:              ${stats.emittedPercent}`)
  console.log(`skipped:                ${stats.skippedNoRate + stats.skippedSpecificOrCompound}`)
  console.log(`  no inherited rate:    ${stats.skippedNoRate}`)
  console.log(`  specific/compound:    ${stats.skippedSpecificOrCompound}`)
  console.log(`output path:            ${OUTPUT_PATH}`)
  console.log(`output bytes:           ${outputBytes}`)
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

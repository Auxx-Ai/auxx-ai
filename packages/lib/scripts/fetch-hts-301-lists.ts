// packages/lib/scripts/fetch-hts-301-lists.ts
//
// Maintainer's tool for the Section 301 list memberships
// (plans/money/tasks/32-tariff-starter-catalogue.md §1.4, revised — see the
// header of `src/bom/tariff-301-memberships.ts` for why this moved out of the
// hand-kept half of the catalogue).
//
// Fetches the HTSUS chapter 99 PDF, extracts the four enumerations in U.S.
// note 20 to subchapter III, and writes
// `packages/lib/src/bom/tariff-301-memberships.json` as one entry per 8-digit
// subheading pointing at the list keys that cover it.
//
//   pnpm --filter @auxx/lib exec tsx scripts/fetch-hts-301-lists.ts
//
// Requires `pdftotext` (poppler) on PATH — `brew install poppler`. The notes
// are published only as a PDF; every other endpoint on hts.usitc.gov returns
// the schedule rows, whose `footnotes` and `additionalDuties` fields are empty
// for Section 301 (checked 2026-09-01).
//
// Expect ~10,000 subheadings across the four lists and a couple of hundred KB
// written. The output is one line per subheading so a re-run's diff is
// reviewable per code.
//
// 🛑 Never edited by hand, and never imported at runtime by anything that
// reaches the browser — see the loader's header.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL =
  'https://hts.usitc.gov/reststop/file?release=currentRelease&filename=Chapter%2099'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(scriptDir, '../src/bom/tariff-301-memberships.json')

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

  const fetchedAt = new Date().toISOString().slice(0, 10)
  writeMembershipsFile(OUTPUT_PATH, fetchedAt, SOURCE_URL, memberships)

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
  console.log(`output path:            ${OUTPUT_PATH}`)
  console.log(`output bytes:           ${statSync(OUTPUT_PATH).size}`)
}

const isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

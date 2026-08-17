// scripts/ci/test-count-ratchet.js
//
// A RATCHET on how many tests each file COLLECTS. Counts may rise freely; a fall
// is an error.
//
// WHY THIS EXISTS. A test file that dies during collection is not reported as N
// failures — Vitest reports it as a suite with **0 tests**, which reads like an
// empty file. #1670 replaced `search-participant-gate.test.ts`'s 17 passing
// tests with zero that way (a `vi.mock('@auxx/database', …)` factory missing the
// `database` export killed the file at import), and it survived review, CI and
// two subsequent merges. Nobody greps for tests that stopped existing.
//
// Exit code cannot catch this on its own: the web lane was already red for
// unrelated reasons, and a red X carried no information. A per-FILE floor does
// catch it, and keeps catching it after the lane is green — losing 17 tests
// fails here even when every remaining test passes.
//
//   node scripts/ci/test-count-ratchet.js --results <vitest-json>
//   node scripts/ci/test-count-ratchet.js --results <vitest-json> --update
//
// The baseline keys on the repo-relative FILE PATH with a test COUNT — not a
// grand total. A total hides the failure this exists for: one file dropping to
// zero while another gains tests nets out to no change.
//
// Produce the input with Vitest's json reporter alongside the normal one:
//
//   npx vitest run --project web --reporter=default \
//     --reporter=json --outputFile=test-results.json
//
// It reads a completed run rather than running the suite itself, so the ratchet
// costs nothing on top of the test job.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'ci', 'test-count-baseline.json')

const args = process.argv.slice(2)
const update = args.includes('--update')
const resultsPath = args.includes('--results') ? args[args.indexOf('--results') + 1] : null

if (!resultsPath) {
  console.error('Usage: node scripts/ci/test-count-ratchet.js --results <vitest-json> [--update]')
  process.exit(2)
}

/**
 * `{ <repo-relative file>: <number of tests collected> }`.
 *
 * `assertionResults` is every test the file produced, whatever its status —
 * failing tests still COUNT, because this ratchet is about collection, not
 * about passing. A file that collapses to zero is the signal; a file whose
 * tests fail is the normal suite's job to report.
 */
function collect(results) {
  const counts = {}
  for (const file of results.testResults ?? []) {
    const key = relative(ROOT, file.name).replaceAll('\\', '/')
    counts[key] = (counts[key] ?? 0) + (file.assertionResults?.length ?? 0)
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return { files: {} }
  }
}

const results = JSON.parse(readFileSync(resolve(resultsPath), 'utf8'))
const current = collect(results)
const baseline = readBaseline()

if (update) {
  // Merge rather than replace: a run scoped to one project must not delete the
  // baselines of the projects it did not run.
  const files = { ...baseline.files, ...current }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) },
      null,
      2
    )}\n`
  )
  const total = Object.values(current).reduce((n, c) => n + c, 0)
  console.log(`recorded ${Object.keys(current).length} file(s), ${total} test(s)`)
  process.exit(0)
}

const before = baseline.files ?? {}
const dropped = []
const missing = []

for (const [file, was] of Object.entries(before)) {
  // Only judge files this run actually covered. A run scoped to `--project web`
  // says nothing about `lib`'s files, and treating their absence as a
  // regression would make every scoped run fail.
  const now = current[file]
  if (now === undefined) {
    missing.push(file)
    continue
  }
  if (now < was) dropped.push({ file, was, now })
}

/** Files the run covered, grouped by their top directory, to scope `missing`. */
const coveredRoots = new Set(Object.keys(current).map((f) => f.split('/').slice(0, 2).join('/')))
const relevantMissing = missing.filter((f) => coveredRoots.has(f.split('/').slice(0, 2).join('/')))

let failed = false

if (dropped.length > 0) {
  failed = true
  console.error(`\n::error::${dropped.length} file(s) collect FEWER tests than the baseline\n`)
  for (const { file, was, now } of dropped) {
    console.error(`  ${file}  ${was} -> ${now}${now === 0 ? '   <-- collects NOTHING' : ''}`)
  }
}

if (relevantMissing.length > 0) {
  failed = true
  console.error(`\n::error::${relevantMissing.length} baselined file(s) produced no result\n`)
  for (const file of relevantMissing) console.error(`  ${file}`)
}

if (failed) {
  console.error(
    `\nA file that collects 0 tests is reported by Vitest as an empty suite, not\n` +
      `as a failure — that is exactly what this check exists to catch. Usually the\n` +
      `cause is a \`vi.mock\` factory that replaces a module and drops an export the\n` +
      `import graph needs (see plans/testing/database-mock-collection-hazard.md).\n\n` +
      `If tests were deliberately deleted or renamed, re-record:\n` +
      `  node scripts/ci/test-count-ratchet.js --results <vitest-json> --update\n`
  )
  process.exit(1)
}

const total = Object.values(current).reduce((n, c) => n + c, 0)
const gained = Object.entries(current).filter(([f, n]) => (before[f] ?? 0) < n).length
console.log(
  `no test-count regressions (${Object.keys(current).length} files, ${total} tests` +
    `${gained > 0 ? `, ${gained} file(s) gained tests 🎉 — tighten with --update` : ''})`
)

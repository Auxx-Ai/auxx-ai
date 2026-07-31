// scripts/ci/typecheck-ratchet.js
//
// A RATCHET, not a gate. `packages/lib` and `apps/web` both carry thousands of
// pre-existing `tsc` errors, so "must be clean" is unshippable and "exit code"
// is meaningless. This asserts the weaker, actually-enforceable property: your
// PR may not ADD type errors. The count is free to fall.
//
// WHY THIS EXISTS. CI ran no typecheck at all, and on 2026-07-30 that shipped a
// production outage. Permissions v3 renamed the lens tiers `full`->`read`, and
// six `apps/web` mail components kept comparing against `'full'` — a comparison
// that is always false, so every member lost message bodies, replying and
// mark-as-read. `tsc` had flagged all six as TS2367 the whole time. They were
// invisible because the standing advice is "grep the output for YOUR files",
// and a renamed shared vocabulary breaks files the PR never touched — there
// were no "your files" to grep for. A per-file rule cannot see that class of
// break. A whole-package ratchet can, which is the entire point of this script.
//
//   node scripts/ci/typecheck-ratchet.js            # check every package
//   node scripts/ci/typecheck-ratchet.js --package lib
//   node scripts/ci/typecheck-ratchet.js --update   # re-record the baseline
//
// The baseline keys on `<file>::<TScode>` with a COUNT, deliberately omitting
// line numbers and messages: both churn on every unrelated edit and would make
// the baseline unmergeable. The tradeoff is that swapping one TS2345 for a
// different TS2345 in the same file is invisible here. That is accepted — this
// catches new *kinds* and new *places*, which is the failure mode that hurt.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'ci', 'typecheck-baseline.json')

/**
 * Packages with a pre-existing error baseline worth ratcheting. Others
 * (`@auxx/database` and friends) are already clean and are enforced by their own
 * `typecheck` script — a ratchet would only weaken them.
 *
 * The heap bump is not optional for these two: web checks ~3.5k files and lib
 * ~2.6k in a single process, and both blow V8's default ~4GB old-space ceiling.
 *
 * ⚠ `TYPECHECK_HEAP_MB` exists because the safe value differs by machine. 8192
 * matches CLAUDE.md and is right on a dev laptop, but a standard GitHub runner
 * has ~7GB of RAM, and letting V8 grow a heap past physical memory trades a
 * clean OOM for swapping. CI passes a lower value and runs ONE package per
 * runner. Web has been observed peaking near 6GB, so there is not much room —
 * if CI starts dying here, move to a larger runner rather than trimming this.
 */
const HEAP_MB = Number(process.env.TYPECHECK_HEAP_MB) || 8192

/**
 * Always typecheck with TypeScript 7, resolved by PATH rather than through
 * `pnpm exec tsc`.
 *
 * `apps/web` deliberately pins `typescript` to 5.9.2 — Next loads
 * `typescript/lib/typescript.js`, which 7's `exports` map does not expose, and
 * without it `next typegen` dies and the web run reports phantom TS2307s (see
 * `pnpm-workspace.yaml`). That pin makes `apps/web/node_modules/.bin/tsc` 5.9.2,
 * so `pnpm exec tsc` would silently measure web on a DIFFERENT compiler than the
 * baseline was recorded with, and `lib` on 7. Naming the binary keeps both on 7.
 */
const TSC_BIN = join(ROOT, 'node_modules', 'typescript7', 'bin', 'tsc')

const PACKAGES = {
  lib: { dir: 'packages/lib' },
  web: { dir: 'apps/web' },
}

/** `src/foo.ts(12,34): error TS2367: ...` → `{ file, code }`. */
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/

/** Path segments whose errors are not source errors. See {@link collectErrors}. */
const GENERATED = ['node_modules', '.next/']

/**
 * Run `tsc --noEmit` in one package and tally errors by `<file>::<code>`.
 *
 * `tsc` exits non-zero whenever it reports anything, so the exit code is
 * discarded and stdout is parsed instead.
 *
 * GENERATED paths are dropped, and both exclusions are load-bearing:
 *  - `node_modules` varies with the installed dependency tree, not the code
 *    under review, and would make the baseline machine-dependent.
 *  - `.next` is Next's own output. `.next/types/validator.ts` is written by
 *    `next typegen` and its error count depends on WHEN it was generated, so a
 *    laptop with a warm `.next` and a runner that just generated one disagree.
 *    Nobody can fix those errors by editing them — they are a projection of the
 *    route tree — so tracking them only produces unfixable red.
 */
function collectErrors(name) {
  const { dir } = PACKAGES[name]
  const result = spawnSync(process.execPath, [TSC_BIN, '--noEmit'], {
    cwd: join(ROOT, dir),
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}` },
  })

  if (result.error) {
    throw new Error(`failed to run tsc in ${dir}: ${result.error.message}`)
  }

  const counts = {}
  for (const line of `${result.stdout ?? ''}`.split('\n')) {
    const match = ERROR_LINE.exec(line.trim())
    if (!match) continue
    const [, file, , , code] = match
    const path = file.replaceAll('\\', '/')
    if (GENERATED.some((segment) => path.includes(segment))) continue
    const key = `${path}::${code}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/** Sorted-key rewrite so the committed baseline diffs readably. */
function sortKeys(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return { packages: {} }
  }
}

/**
 * Compare one package against its baseline.
 *
 * Regressions are new keys and grown counts. Improvements are reported but
 * never fail — a contributor who deletes errors should not be asked to also
 * update a file they had no reason to open.
 */
function compare(name, current, baseline) {
  const before = baseline.packages?.[name] ?? {}
  const regressions = []
  const improvements = []

  for (const [key, count] of Object.entries(current)) {
    const was = before[key] ?? 0
    if (count > was) regressions.push({ key, was, now: count })
  }
  for (const [key, was] of Object.entries(before)) {
    const now = current[key] ?? 0
    if (now < was) improvements.push({ key, was, now })
  }

  return { regressions, improvements, before: total(before), now: total(current) }
}

const args = process.argv.slice(2)
const update = args.includes('--update')
const only = args.includes('--package') ? args[args.indexOf('--package') + 1] : null
const names = only ? [only] : Object.keys(PACKAGES)

for (const name of names) {
  if (!PACKAGES[name]) {
    console.error(`Unknown package "${name}". Known: ${Object.keys(PACKAGES).join(', ')}`)
    process.exit(2)
  }
}

const baseline = readBaseline()
let failed = false

for (const name of names) {
  process.stderr.write(`typechecking ${PACKAGES[name].dir}…\n`)
  const current = sortKeys(collectErrors(name))

  if (update) {
    baseline.packages = { ...baseline.packages, [name]: current }
    console.log(`${name}: recorded ${total(current)} pre-existing errors`)
    continue
  }

  const { regressions, improvements, before, now } = compare(name, current, baseline)

  if (regressions.length > 0) {
    failed = true
    console.error(`\n::error::${name}: ${regressions.length} NEW type error location(s)\n`)
    for (const { key, was, now: n } of regressions) {
      const [file, code] = key.split('::')
      console.error(`  ${file}  ${code}  ${was} -> ${n}`)
    }
    console.error(
      `\nThese are errors your branch introduced. Fix them — do NOT re-record the\n` +
        `baseline to make this pass. If a rename moved existing errors between files,\n` +
        `run: node scripts/ci/typecheck-ratchet.js --update --package ${name}\n`
    )
  } else {
    console.log(`${name}: no new type errors (${now} total, baseline ${before})`)
  }

  if (improvements.length > 0) {
    const fixed = improvements.reduce((sum, i) => sum + (i.was - i.now), 0)
    console.log(
      `${name}: ${fixed} error(s) fixed 🎉 — tighten with ` +
        `\`node scripts/ci/typecheck-ratchet.js --update --package ${name}\``
    )
  }
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`\nBaseline written to scripts/ci/typecheck-baseline.json`)
}

process.exit(failed ? 1 : 0)

// scripts/ci/raw-query-ratchet.js
//
// A RATCHET, not a gate. `audit-log/` is the one module that should write
// `AuditLog`; `connections/`/`credentials/` the only ones that should read
// `Credential` (docs/lib-module-guide.md §8). Nine files still read `Credential`
// directly pending a follow-up sweep, so this can't be a gate — it can ratchet: a
// NEW bypass, or a listed file growing a second one, fails; the baseline only
// ever shrinks.
//
//   node scripts/ci/raw-query-ratchet.js
//   node scripts/ci/raw-query-ratchet.js --update   # re-record the baseline
//
// The baseline keys on `<rule>` -> `{ <repo-relative file>: <hit count> }`,
// mirroring typecheck-ratchet.js's `<file>::<code>` shape: line numbers churn on
// unrelated edits.

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'ci', 'raw-query-baseline.json')
const LIB_SRC = join(ROOT, 'packages', 'lib', 'src')

/**
 * Each rule: a name, the pattern that marks a bypass, and the directories (relative
 * to `packages/lib/src`, matched as a path segment) that are exempt because they own
 * the table.
 */
const RULES = [
  {
    name: 'auditLogInsert',
    label: 'insert(AuditLog) outside audit-log/',
    // `schema.` is optional — record-audit.ts itself imports the bare `AuditLog`
    // binding, so a bypass can too.
    pattern: /insert\((schema\.)?AuditLog\)/,
    exemptDirs: ['audit-log'],
  },
  {
    name: 'credentialFrom',
    label: 'raw Credential read outside connections/ and credentials/',
    // Both Drizzle read shapes, each with or without the `schema.` prefix:
    // `.from((schema.)Credential)` and `db.query.Credential.findFirst/findMany(...)`.
    pattern: /from\((schema\.)?Credential\)|\bquery\.Credential\.\w+\(/,
    exemptDirs: ['connections', 'credentials'],
  },
]

function isExempt(relPath, exemptDirs) {
  const segments = relPath.split('/')
  return exemptDirs.some((dir) => segments.includes(dir))
}

/** `{ <repo-relative file>: <hit count> }` for one rule, across every non-test source file. */
function collect(rule) {
  const files = globSync('**/*.ts', { cwd: LIB_SRC }).filter(
    (f) => !f.endsWith('.test.ts') && !f.includes('__tests__/')
  )
  const counts = {}
  for (const file of files) {
    const absPath = join(LIB_SRC, file)
    const relPath = relative(ROOT, absPath).replaceAll('\\', '/')
    if (isExempt(relPath, rule.exemptDirs)) continue
    const text = readFileSync(absPath, 'utf8')
    const hits = text.match(new RegExp(rule.pattern, 'g'))
    if (hits?.length) counts[relPath] = hits.length
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

const args = process.argv.slice(2)
const update = args.includes('--update')
const baseline = readBaseline()
let failed = false
const nextBaseline = {}

for (const rule of RULES) {
  const current = collect(rule)
  nextBaseline[rule.name] = current

  if (update) continue

  const before = baseline[rule.name] ?? {}
  const regressions = []
  for (const [file, count] of Object.entries(current)) {
    const was = before[file] ?? 0
    if (count > was) regressions.push({ file, was, now: count })
  }

  if (regressions.length > 0) {
    failed = true
    console.error(`\n::error::${rule.label}: ${regressions.length} new bypass(es)\n`)
    for (const { file, was, now } of regressions) {
      console.error(`  ${file}  ${was} -> ${now}`)
    }
  } else {
    console.log(`${rule.label}: no new bypasses (${Object.keys(current).length} file(s) baselined)`)
  }
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(nextBaseline, null, 2)}\n`)
  console.log(`Baseline written to scripts/ci/raw-query-baseline.json`)
} else if (failed) {
  console.error(
    `\nUse the module's export instead of the raw query (docs/lib-module-guide.md §8).\n` +
      `If a listed file was fixed and a raw query moved rather than shrank, re-record:\n` +
      `  node scripts/ci/raw-query-ratchet.js --update\n`
  )
}

process.exit(failed ? 1 : 0)

// scripts/ci/raw-query-ratchet.js
//
// A RATCHET, not a gate. A module that owns a table exports its reads and writes
// (docs/lib-module-guide.md §8); every other file that still queries the table by
// hand is baselined here, so a NEW bypass, or a listed file growing a second one,
// fails, and the baseline only ever shrinks. Rules: plans/accounting/LIB-READS.md §5.
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

/** `from|insert|update|delete((schema.)T)` and `query.T.<fn>(` for the named tables. */
function tableAccess(tables) {
  return new RegExp(
    `\\b(from|insert|update|delete)\\((schema\\.)?(${tables})\\)|\\bquery\\.(${tables})\\.\\w+\\(`
  )
}

/**
 * Each rule: the pattern that marks a bypass, plus what is exempt because it owns the
 * table — `exemptDirs` (a path segment) or `exempt` (a prefix relative to
 * `packages/lib/src`). `scope` limits a rule to prefixes; everything else is ignored.
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
  {
    name: 'moneyRaw',
    label: 'raw money-table access outside accounting/money reads/writes',
    pattern: tableAccess(
      'MoneyTransaction|MoneyApplication|MoneyRefundSettlement|MoneySourceLink|MoneyCommand|MoneyTransfer'
    ),
    exempt: [
      'accounting/money/reads.ts',
      'accounting/money/writes.ts',
      'accounting/money/commands/',
      'accounting/money/bank-deposits/',
      'accounting/money/blocked-movements.ts',
      'accounting/money/post-movement.ts',
    ],
  },
  {
    name: 'ledgerRaw',
    label: 'raw ledger-table access outside accounting/ledger reads, post, roles',
    pattern: tableAccess('GlPosting|GlPostingLine|GlPostingSource|GlRoleAssignment'),
    exempt: [
      'accounting/ledger/reads/',
      'accounting/ledger/post/',
      'accounting/ledger/roles/',
      'accounting/reports/',
    ],
  },
  {
    name: 'exportRaw',
    label: 'raw ExportBatch access outside accounting/export',
    pattern: tableAccess('ExportBatch|ExportBatchPosting'),
    exempt: ['accounting/export/'],
  },
  {
    name: 'sourceRaw',
    label: 'raw financial-source access outside its owners',
    pattern: tableAccess('FinancialSource\\w+|ProcessorBalanceEntry'),
    exempt: [
      'accounting/money/customer-money/source-reads.ts',
      'accounting/money/customer-money/source-writes.ts',
      'accounting/money/customer-money/record-storage.ts',
      'accounting/money/customer-money/record-evidence.ts',
      'accounting/ledger/roles/source-scope.ts',
      'accounting/money/payouts/entry-reads.ts',
    ],
  },
  {
    name: 'recurrenceRaw',
    label: 'raw RecurrenceRule access outside recurrence/',
    pattern: tableAccess('RecurrenceRule'),
    exempt: ['recurrence/'],
  },
  {
    name: 'allocationRaw',
    label:
      'raw allocation/installment/visit access outside sales/billing/allocations.ts and dispatch/',
    pattern: tableAccess(
      'InvoiceLineAllocation|InvoiceVisitAllocation|InvoiceScheduleAllocation|WorkOrderBillingInstallment|WorkOrderVisit'
    ),
    exempt: ['accounting/sales/billing/allocations.ts', 'dispatch/'],
  },
  {
    name: 'connectorRaw',
    label: 'raw DataConnector access outside data-connectors/',
    pattern: tableAccess('DataConnector'),
    exempt: ['data-connectors/'],
  },
  {
    name: 'fieldValueRaw',
    label:
      'raw FieldValue select in accounting/ and inventory/ (resources/system-records is the reader)',
    pattern: /from\((schema\.)?FieldValue\)/,
    scope: ['accounting/', 'inventory/'],
    exempt: [],
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
    const libRel = file.replaceAll('\\', '/')
    if (rule.scope && !rule.scope.some((prefix) => libRel.startsWith(prefix))) continue
    if (rule.exemptDirs && isExempt(relPath, rule.exemptDirs)) continue
    if (rule.exempt?.some((prefix) => libRel.startsWith(prefix))) continue
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

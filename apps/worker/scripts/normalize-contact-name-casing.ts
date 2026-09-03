// apps/worker/scripts/normalize-contact-name-casing.ts
//
// One-time contact name casing repair (plans/records/contact-name-casing-plan.md §5) —
// thin caller around `backfillContactNameCasing` in `@auxx/lib/records` (query code
// lives in lib; apps/worker has no drizzle-orm dependency of its own).
//
// The pre-hook covers every name written from now on; this is for what is already
// stored. Deliberately a script rather than a `DataMigration`: it rewrites user data on
// a judgement call, so it is run per-org on purpose after looking at `--dry-run`.
//
// ⚠️ Writes INLINE — no worker needs to be running, and nothing is queued.
//
// ⚠️ Expect the duplicate scanner to re-examine every record this touches:
// `EntityInstance.updatedAt` is bumped by the write. That is load, not corruption, and
// it settles on its own.
//
// Safe to re-run: `toDisplayCase` returns already-correct names unchanged, so a second
// pass finds nothing.
//
// Run (from repo root):
//   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
//     scripts/normalize-contact-name-casing.ts [organizationId] [--dry-run] [--verbose]

import { closePools, database } from '@auxx/database'
import { backfillContactNameCasing, type NameCaseChange } from '@auxx/lib/records'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const verbose = args.includes('--verbose') || dryRun
  const organizationId = args.find((a) => !a.startsWith('--'))

  const scope = organizationId ? `org ${organizationId}` : 'every org'
  console.log(`Contact name casing repair — ${scope}${dryRun ? ' (dry run)' : ''}`)

  // A dry run's whole purpose is the diff, so it prints every pair by default. A real run
  // stays quiet unless asked, because 1,600 lines of output buries the summary.
  const samples: NameCaseChange[] = []
  const onChange = (change: NameCaseChange) => {
    if (verbose) {
      console.log(`  ${change.attribute.padEnd(10)} ${change.from}  ->  ${change.to}`)
    } else if (samples.length < 20) {
      samples.push(change)
    }
  }

  const summary = await backfillContactNameCasing(database, {
    ...(organizationId ? { organizationId } : {}),
    dryRun,
    onChange,
  })

  if (summary.changed === 0) {
    console.log(
      `Scanned ${summary.scanned} name values across ${summary.organizations} orgs — ` +
        'nothing needs repairing.'
    )
    await closePools()
    process.exit(0)
  }

  if (samples.length > 0) {
    console.log(`\nFirst ${samples.length} of ${summary.changed}:`)
    for (const s of samples) console.log(`  ${s.attribute.padEnd(10)} ${s.from}  ->  ${s.to}`)
    console.log('  (run with --verbose for all of them)')
  }

  console.log(
    `\nScanned ${summary.scanned} name values across ${summary.organizations} orgs.\n` +
      `${summary.changed} values need repairing.`
  )
  if (dryRun) {
    console.log('Dry run — nothing was written. Re-run without --dry-run to apply.')
  } else {
    console.log(`${summary.recordsWritten} records written.`)
  }
  await closePools()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

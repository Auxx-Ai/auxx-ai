// apps/worker/scripts/resolve-interactions-backfill.ts
//
// One-time interaction-resolution backfill (plans/company/v5-interaction-resolution.md §7,
// caller 3) — thin caller around `sweepInteractionResolution` in `@auxx/lib/interactions`
// (query code lives in lib; apps/worker has no drizzle-orm dependency of its own).
//
// This is the tool for records that arrived before the two live callers existed, and the one
// to run after any large historical import. It passes `allTime`, which is exactly what the
// nightly sweep does NOT do: the sweep is windowed to 30 days because "has no interaction
// stamps" never converges (a contact who has never written to us never gets one), while a
// single deliberate pass over the whole table is fine.
//
// Safe to re-run and cheap when there is nothing to do: every phase is guarded (`IS NULL` on
// the participant and thread links, monotonic first-wins/last-wins on the stamps), so a
// second run writes nothing.
//
// ⚠️ Unlike the enrichment backfill this resolves INLINE — no worker needs to be running,
// and nothing is queued. It writes as it goes.
//
// Run (from repo root):
//   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
//     scripts/resolve-interactions-backfill.ts [organizationId] [--dry-run] [--window]

import { sweepInteractionResolution } from '@auxx/lib/interactions'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  // `--window` restricts to the nightly job's 30-day window, for rehearsing what the sweep
  // would do rather than recovering history.
  const allTime = !args.includes('--window')
  const organizationId = args.find((a) => !a.startsWith('--'))

  const scope = organizationId ? `org ${organizationId}` : 'every org'
  console.log(
    `Interaction resolution backfill — ${scope}` +
      `${allTime ? '' : ' (30-day window)'}${dryRun ? ' (dry run)' : ''}`
  )

  const summary = await sweepInteractionResolution({
    ...(organizationId ? { organizationId } : {}),
    allTime,
    dryRun,
    // A deliberate one-off pass may go much wider than the nightly job.
    maxRecords: 100_000,
    maxPerOrganization: 100_000,
  })

  if (summary.candidates === 0) {
    console.log('No contacts or companies without interaction stamps — nothing to do.')
    process.exit(0)
  }

  console.log(
    `${summary.candidates} candidates across ${summary.organizations} orgs` +
      `${summary.deferred > 0 ? `, ${summary.deferred} deferred past the per-org cap` : ''}.`
  )
  if (dryRun) {
    console.log(`${summary.resolved} would be resolved.`)
    process.exit(0)
  }

  console.log(
    [
      `participants adopted: ${summary.participantsAdopted}`,
      `thread participants backfilled: ${summary.threadParticipantsBackfilled}`,
      `contacts stamped: ${summary.contactsStamped}`,
      `companies stamped: ${summary.companiesStamped}`,
      `employers attached: ${summary.employersAttached}`,
    ].join('\n')
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

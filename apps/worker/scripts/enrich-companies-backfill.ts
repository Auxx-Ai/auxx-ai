// apps/worker/scripts/enrich-companies-backfill.ts
//
// One-time enrichment backfill (plans/company/v4-enrichment-doors.md §5, Door 5a) — thin
// caller around `sweepCompaniesNeedingEnrichment` in `@auxx/lib/companies` (query code
// lives in lib; apps/worker has no drizzle-orm dependency of its own).
//
// Safe to re-run. It only selects companies with no terminal enrichment status, and every
// company it queues reaches one — including `skipped` for the ones with neither a domain
// nor a usable website, which is the point: those records currently carry NO trace at all,
// so the gap is invisible in the UI.
//
// ⚠️ It ENQUEUES; the fetches happen on the enrichment worker. Nothing is enriched unless a
// worker is running. The per-org hourly budget still applies, so a very large org drains
// across several runs (or waits for the nightly sweep).
//
// Run (from repo root) under the worker runtime:
//   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
//     scripts/enrich-companies-backfill.ts [organizationId] [--dry-run]

import { sweepCompaniesNeedingEnrichment } from '@auxx/lib/companies'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const organizationId = args.find((a) => !a.startsWith('--'))

  const scope = organizationId ? `org ${organizationId}` : 'every org'
  console.log(`Company enrichment backfill — ${scope}${dryRun ? ' (dry run)' : ''}`)

  const summary = await sweepCompaniesNeedingEnrichment({
    ...(organizationId ? { organizationId } : {}),
    dryRun,
  })

  if (summary.candidates === 0) {
    console.log('No companies without a terminal enrichment status — nothing to do.')
  } else {
    console.log(
      `${summary.candidates} candidates across ${summary.organizations} orgs → ` +
        `${summary.enqueued} ${dryRun ? 'would be queued' : 'queued'}, ` +
        `${summary.deferred} deferred past the per-org cap.`
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

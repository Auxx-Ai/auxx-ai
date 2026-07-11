// apps/worker/scripts/backfill-geocode-visits.ts
//
// One-time geocode backfill (plans/dispatch/09-route-planner.md §I) — thin caller around
// `backfillGeocodeVisits` in `@auxx/lib/dispatch` (query code lives in lib; apps/worker has no
// drizzle-orm dependency of its own). Safe to re-run; skips already-geocoded visits.
//
// Run (from repo root) under the worker runtime:
//   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
//     scripts/backfill-geocode-visits.ts [organizationId]

import { backfillGeocodeVisits } from '@auxx/lib/dispatch'

async function main() {
  if (!process.env.MAPTILER_API_KEY) {
    console.error('MAPTILER_API_KEY is not set — nothing would geocode. Aborting.')
    process.exit(1)
  }
  const onlyOrgId = process.argv[2]

  const result = await backfillGeocodeVisits(onlyOrgId)
  if (result.ungeocodedVisits === 0) {
    console.log('No ungeocoded visits found — nothing to do.')
  } else {
    console.log(
      `${result.ungeocodedVisits} ungeocoded visits across ${result.workOrders} work orders → ` +
        `${result.geocoded} geocoded, ${result.noAddress} without an address, ${result.failed} failures.`
    )
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

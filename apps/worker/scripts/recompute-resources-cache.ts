// apps/worker/scripts/recompute-resources-cache.ts
/**
 * Recompute the org-cache `resources` payload for all orgs from CURRENT source
 * (the web dev server holds pre-showInDialogs lib code in memory until its next
 * restart — its recomputes produce a payload without the new field flags).
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/recompute-resources-cache.ts
 */

import { database, schema } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  for (const org of orgs) {
    await getOrgCache().invalidateAndRecompute(org.id, ['resources', 'customFields'])
    console.log(`recomputed resources + customFields cache: ${org.id}`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

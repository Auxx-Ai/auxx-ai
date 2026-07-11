// apps/worker/scripts/reorder-service-request-fields.ts
/**
 * LOCAL DEV script (no migration — dispatch isn't in production yet). Re-syncs the
 * per-org `CustomField.sortOrder` for the `service_request` system fields to the new
 * default order declared in
 * `packages/lib/src/resources/registry/resources/service-request-fields.ts`:
 *
 *   number → title → contact → status → description → (the rest)
 *
 * WHY a script is needed: `sortOrder` is persisted per-org in the DB at seed time
 * (copied from `systemSortOrder`), and the field panel / create dialog order come
 * from that column — editing `systemSortOrder` in the registry only affects NEWLY
 * seeded orgs. `showInPanel` (the field hides) is read live from the static registry
 * on every merge, so those need no DB change — just a lib rebuild + this cache flush.
 *
 * All target attributes are `service_request_*`-prefixed (unique to that entity), so a
 * plain systemAttribute match is safe — no entity-def scoping needed. Existing orgs
 * that saved a custom service_request field VIEW keep their own order (by design).
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/reorder-service-request-fields.ts
 */

import { database } from '@auxx/database'
import { flushOrganization } from '@auxx/lib/cache'

/**
 * systemAttribute → new sortOrder — mirrors the `systemSortOrder` values in
 * service-request-fields.ts and work-order-fields.ts. Every attribute here is
 * uniquely prefixed (`service_request_*` / `work_order_*`), so a plain
 * systemAttribute match is safe with no entity-def scoping.
 */
const SORT_ORDER: Record<string, string> = {
  // Service request: number → title → contact → status → description → rest
  service_request_number: 'a1',
  service_request_title: 'a2',
  service_request_contact: 'a3',
  service_request_status: 'a4',
  service_request_description: 'a5',
  service_request_property_type: 'a6',
  service_request_preferred_date: 'a7',
  service_request_alternate_date: 'a8',
  service_request_arrival_window: 'a9',
  service_request_address: 'aA',
  service_request_ticket: 'aB',
  service_request_work_orders: 'aC',
  service_request_quotes: 'aD',

  // Work order: contact moved up to below title (rest keep their order)
  work_order_contact: 'a3',
  work_order_description: 'a4',
  work_order_status: 'a5',
  work_order_priority: 'a6',
  work_order_job_type: 'a7',
}

async function main() {
  const client = database.$client

  const orgs = await database.query.Organization.findMany({ columns: { id: true, name: true } })
  console.log(`Reordering service_request fields across ${orgs.length} org(s)…\n`)

  let totalUpdated = 0
  for (const org of orgs) {
    let orgUpdated = 0
    for (const [systemAttribute, sortOrder] of Object.entries(SORT_ORDER)) {
      const res = await client.query(
        `UPDATE "CustomField" SET "sortOrder" = $1
           WHERE "organizationId" = $2 AND "systemAttribute" = $3`,
        [sortOrder, org.id, systemAttribute]
      )
      orgUpdated += res.rowCount ?? 0
    }
    if (orgUpdated > 0) {
      await flushOrganization(org.id)
      totalUpdated += orgUpdated
      console.log(`  ✅ ${org.name ?? org.id}: ${orgUpdated} field(s) reordered + cache flushed`)
    }
  }

  console.log(`\nDone. ${totalUpdated} CustomField row(s) updated.`)
  await client.end?.()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

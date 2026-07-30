// packages/lib/scripts/check-record-access-stamp.ts
//
// End-to-end check that a per-record `ResourceAccess` grant actually reaches the
// `_access` stamp, the sharing guard and the access-request lane — AGAINST THE
// REAL DATABASE.
//
// This exists because the vitest suite structurally cannot answer the question:
// `@auxx/database`'s `schema` is mocked to a Proxy whose columns are `undefined`,
// so the record-lane subqueries never render production SQL there. A correlation
// defect in `recordAccessRankSql` (the outer id flattening to a bare `"id"` and
// binding to `ResourceAccess.id`) folded every per-record grant away to the def
// rung — fail-closed, silent, and green across 1660 lib tests.
// `record-scope-correlation.test.ts` pins the mechanism; this pins the wiring.
//
// Usage:
//   npx dotenv -- npx tsx packages/lib/scripts/check-record-access-stamp.ts \
//     <organizationId> <userId> <entityDefinitionId> <entityInstanceId>

import { database as db } from '@auxx/database'
import {
  loadRecordAuthorityContext,
  preflightRecordAccessRequest,
  recordRungFor,
} from '../src/approval-requests'
import { getCapabilities } from '../src/permissions/capabilities/get-capabilities'
import { UnifiedCrudHandler } from '../src/resources/crud/unified-handler'
import type { RecordId } from '../src/resources/resource-id'

async function main() {
  const [organizationId, userId, entityDefinitionId, entityInstanceId] = process.argv.slice(2)
  if (!organizationId || !userId || !entityDefinitionId || !entityInstanceId) {
    console.error(
      'usage: check-record-access-stamp <organizationId> <userId> <entityDefinitionId> <entityInstanceId>'
    )
    process.exit(1)
  }

  const recordId = `${entityDefinitionId}:${entityInstanceId}` as RecordId
  const capabilities = await getCapabilities(userId, organizationId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db, undefined, { capabilities })

  const byIds = await handler.getByIds([recordId])
  const stamped = Object.values(byIds).map((item) => (item as { _access?: string })._access)

  const ctx = await loadRecordAuthorityContext(
    db,
    organizationId,
    entityDefinitionId,
    entityInstanceId
  )
  const preflight = await preflightRecordAccessRequest(
    db,
    organizationId,
    userId,
    entityDefinitionId,
    entityInstanceId
  )

  console.log({
    defRung: capabilities.recordDefRung(entityDefinitionId),
    getByIdsAccess: stamped,
    getByIdAccess: (await handler.getById(recordId))?._access,
    recordRungFor: ctx ? await recordRungFor(db, organizationId, userId, capabilities, ctx) : null,
    preflight: {
      eligible: preflight.eligible,
      currentRung: preflight.currentRung,
      requestedRung: preflight.requestedRung,
      refusalReason: preflight.refusalReason,
    },
  })
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

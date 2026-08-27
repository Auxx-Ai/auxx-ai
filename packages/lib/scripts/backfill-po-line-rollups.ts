// packages/lib/scripts/backfill-po-line-rollups.ts
//
// One-time backfill: re-SUM `purchase_order_line_quantity_received` and
// `purchase_order_line_quantity_billed` for every purchase order line that has
// linked children, repairing lines whose roll-up never ran.
//
// WHY THESE ROWS EXIST: the `mfg-stock-movements-created` system rule gained a
// third action (`recalculatePurchaseOrderLineReceived`), but the resolved rule
// was cached per-org for a day, so orgs kept firing the OLD two-action list.
// Movements were written and linked correctly while the roll-up silently never
// ran — a PO reading zero received with the ledger underneath it complete. The
// cache no longer holds system rules (`packages/lib/src/cache/org-system-rules.ts`),
// so this is a one-time repair of what the stale window missed.
//
// Idempotent: it recalculates from the subledger, which is the truth. Re-running
// rewrites the same values. Lines with no children are skipped, not zeroed.
//
// Run from the repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-po-line-rollups.ts

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'
// Relative import on purpose: `generate-exports.ts` derives package.json exports
// from consumer imports under apps/ + packages/ and skips packages/lib itself, so
// this module has no public subpath to import by name.
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollup,
} from '../src/field-hooks/post/purchase-order-line-rollups'

/** Every (org, purchase order line) pair reachable from a child that names it. */
async function affectedLines(childRelAttr: string): Promise<{ org: string; line: string }[]> {
  const rows = await database.execute<{ organizationId: string; poLineId: string }>(sql`
    SELECT DISTINCT fv."organizationId", fv."relatedEntityId" AS "poLineId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    WHERE cf."systemAttribute" = ${childRelAttr}
      AND fv."relatedEntityId" IS NOT NULL
  `)
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
  return (list as { organizationId: string; poLineId: string }[]).map((r) => ({
    org: r.organizationId,
    line: r.poLineId,
  }))
}

async function main(): Promise<void> {
  for (const [name, spec] of Object.entries(PURCHASE_ORDER_LINE_ROLLUPS)) {
    const lines = await affectedLines(spec.lineRelAttr)
    console.log(`${name}: ${lines.length} purchase order line(s) with children`)

    let ok = 0
    for (const { org, line } of lines) {
      try {
        await recalculatePurchaseOrderLineRollup(org, line, spec)
        ok++
      } catch (error) {
        console.error(
          `  FAILED ${name} for line ${line} (org ${org}):`,
          error instanceof Error ? error.message : error
        )
      }
    }
    console.log(`${name}: recalculated ${ok}/${lines.length}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

// packages/lib/scripts/backfill-vendor-bill-balance.ts
//
// One-time backfill: write `vendor_bill_balance` for every vendor bill that
// carries a total.
//
// WHY THESE ROWS EXIST: the field shipped declared `creatable: false`, "computed
// from total and amountPaid", with NO writer of any kind — zero FieldValue rows
// in the whole installation. `purchasing/vendor-bill-balance.ts` is now that
// writer, but a hook only fires on a write, so every already-entered bill would
// have stayed NULL until somebody re-keyed its total. This is that one pass.
//
// Idempotent: it recalculates from the bill's own stored total and amount paid,
// and the writer skips the write when the stored balance already agrees. Bills
// with no total are skipped, not zeroed — an unentered invoice owes an unknown
// amount, not nothing.
//
// Run from the repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-vendor-bill-balance.ts

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'
// Relative import on purpose — see the note in backfill-po-line-rollups.ts.
import { recalculateVendorBillBalance } from '../src/purchasing/vendor-bill-balance'

/** Every (org, vendor bill) pair where a total has been keyed. */
async function billsWithATotal(): Promise<{ org: string; bill: string }[]> {
  const rows = await database.execute<{ organizationId: string; billId: string }>(sql`
    SELECT DISTINCT fv."organizationId", fv."entityId" AS "billId"
    FROM "FieldValue" fv
    JOIN "CustomField" cf ON cf.id = fv."fieldId"
    WHERE cf."systemAttribute" = 'vendor_bill_total'
      AND fv."valueNumber" IS NOT NULL
  `)
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
  return (list as { organizationId: string; billId: string }[]).map((r) => ({
    org: r.organizationId,
    bill: r.billId,
  }))
}

async function main(): Promise<void> {
  const bills = await billsWithATotal()
  console.log(`${bills.length} vendor bill(s) carrying a total`)

  let written = 0
  for (const { org, bill } of bills) {
    if (await recalculateVendorBillBalance(org, bill)) written++
  }

  console.log(`balances written: ${written}, unchanged: ${bills.length - written}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

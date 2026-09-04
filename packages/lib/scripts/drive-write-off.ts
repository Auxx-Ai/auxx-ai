// packages/lib/scripts/drive-write-off.ts
//
// Drives slot 2K's write-off end to end against a real org (HANDOFF §7 "Drive
// it"): writes off part of an open invoice's balance, then prints
// `verifyBooksBalance` and the 1099 summary for the current year.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-write-off.ts

import { closePools, database } from '@auxx/database'
import { writeOffInvoice } from '../src/money/invoices/write-off'
import { readVendor1099Summary } from '../src/postings/reports/vendor-1099'
import { verifyBooksBalance } from '../src/postings/verify-balance'

// DemoOrg1, owner markus@auxx.ai (HANDOFF §9a).
const ORG_ID = 'abgwpa1l81reht2zmwrcihfu'
const ACTOR_USER_ID = '6rzjGiHkFWXoS3lCJtXBB0EdAMztMZHZ'
// INV-0005, partially_paid, balance 69583 minor units ($695.83) at the time
// this script was written - re-select if it has since changed.
const INVOICE_ID = 'jsou9lg23iitzv2wkxybu4l4'
const WRITE_OFF_AMOUNT_MINOR = 20_000 // $200.00 of the $695.83 balance

async function main() {
  console.log(`Writing off $${(WRITE_OFF_AMOUNT_MINOR / 100).toFixed(2)} of invoice ${INVOICE_ID}…`)

  const result = await writeOffInvoice(database, {
    organizationId: ORG_ID,
    actorUserId: ACTOR_USER_ID,
    invoiceId: INVOICE_ID,
    amountMinor: WRITE_OFF_AMOUNT_MINOR,
    reason: 'Driven by scripts/drive-write-off.ts - partial settlement, customer disputes the rest',
  })
  console.log('writeOffInvoice result:', JSON.stringify(result, null, 2))

  const balance = await verifyBooksBalance(database, ORG_ID)
  if (balance.isErr()) {
    console.error('verifyBooksBalance errored:', balance.error)
  } else {
    console.log('verifyBooksBalance:', JSON.stringify(balance.value, null, 2))
  }

  const year = new Date().getFullYear()
  const summary = await readVendor1099Summary(database, { organizationId: ORG_ID, year })
  if (summary.isErr()) {
    console.error('readVendor1099Summary errored:', summary.error)
  } else {
    console.log(`vendor1099Summary (${year}):`, JSON.stringify(summary.value, null, 2))
  }

  await closePools()
  process.exit(0)
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})

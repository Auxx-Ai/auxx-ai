// packages/lib/scripts/drive-fulfillment.ts
//
// Drives HANDOFF slot 2G end to end against a real org: fulfil one order in
// full, fulfil a second in two parts, record a payment against an invoice, and
// print `verifyBooksBalance` plus the trial balance with A/R and revenue on it.
//
// The sibling of `drive-bank-deposit.ts` and `drive-journal-entry.ts`. It
// WRITES: it posts real `GlPosting` rows and it sets `order_channel` on the two
// orders it picks, because every seeded order in DemoOrg1 carries `manual`,
// which the channel table refuses by design. Point it at a dev org.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-fulfillment.ts <organizationId>

import { closePools, database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../src/cache'
import { fulfillOrder, previewFulfillment, readOrderForFulfillment } from '../src/money/orders'
import { recordManualPayment } from '../src/money/payments/ledger'
import { readTrialBalance, verifyBooksBalance } from '../src/postings'
import { UnifiedCrudHandler } from '../src/resources/crud/unified-handler'
import { toRecordId } from '../src/resources/resource-id'

const TODAY = new Date().toISOString().slice(0, 10)

async function main() {
  const organizationId = process.argv[2]
  if (!organizationId) throw new Error('usage: drive-fulfillment.ts <organizationId>')

  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')
  const actorUserId = member.userId

  let orderIds = await pickOrders(organizationId)
  if (orderIds.length < 2) {
    // An org with no unfulfilled orders gets two seeded, so the drive is the
    // same on a fresh org as on DemoOrg1.
    const seeded = [
      await seedDemoOrder(organizationId, actorUserId, 'manual'),
      await seedDemoOrder(organizationId, actorUserId, 'dealer'),
    ]
    console.log(`RESULT seeded=${seeded.join(',')}`)
    orderIds = [...seeded, ...orderIds]
  }
  console.log(`RESULT candidates=${orderIds.length} first=${orderIds[0]}`)

  // ── 1. The channel refusal, before anything is set ───────────────────────
  const refused = await fulfillOrder(database, {
    organizationId,
    actorUserId,
    orderId: orderIds[0]!,
    shippedLines: await allRemaining(organizationId, orderIds[0]!),
    shippedAt: TODAY,
  })
  console.log(
    `RESULT manualChannelRefused=${refused.isErr() ? refused.error.message.slice(0, 120) : 'NOT REFUSED'}`
  )

  // ── 2. Two orders get a real channel ─────────────────────────────────────
  await setChannel(organizationId, actorUserId, orderIds[0]!, 'dtc')

  // ── 3. Order one, fulfilled in full ──────────────────────────────────────
  const fullLines = await allRemaining(organizationId, orderIds[0]!)
  const preview = await previewFulfillment(database, {
    organizationId,
    orderId: orderIds[0]!,
    shippedLines: fullLines,
    shippedAt: TODAY,
  })
  if (preview.isErr()) throw preview.error
  console.log(
    `RESULT preview doc=${preview.value.docNumber} total=${preview.value.totalMinor} ` +
      `lines=${preview.value.lines.map((l) => `${l.accountCode}:${l.direction}:${l.amount}`).join(' ')} ` +
      `blocked=${preview.value.blockedBy?.status ?? 'none'} ${preview.value.blockedBy?.error ?? ''}`
  )

  const full = await fulfillOrder(database, {
    organizationId,
    actorUserId,
    orderId: orderIds[0]!,
    shippedLines: fullLines,
    shippedAt: TODAY,
  })
  if (full.isErr()) throw full.error
  console.log(
    `RESULT full status=${full.value.fulfillmentStatus} post=${full.value.post.status} ` +
      `doc=${full.value.post.docNumber ?? ''} total=${full.value.fulfillment.totalMinor} ` +
      `${full.value.post.error ?? ''}`
  )

  // A second full shipment must be refused: nothing remains.
  const again = await fulfillOrder(database, {
    organizationId,
    actorUserId,
    orderId: orderIds[0]!,
    shippedLines: fullLines,
    shippedAt: TODAY,
  })
  console.log(`RESULT reship=${again.isErr() ? again.error.message.slice(0, 120) : 'NOT REFUSED'}`)

  // ── 4. Order two, fulfilled in two parts ─────────────────────────────────
  //
  // The order has to have a line of at least two units for a two-part shipment
  // to mean anything, so the candidate list is scanned rather than indexed:
  // plenty of seeded orders are one unit of one thing.
  const partialOrderId = await pickPartialOrder(organizationId, orderIds.slice(1))
  await setChannel(organizationId, actorUserId, partialOrderId, 'dealer')
  const second = await readOrderForFulfillment(database, {
    organizationId,
    orderId: partialOrderId,
  })
  if (second.isErr()) throw second.error
  const line = [...second.value.lines].sort((a, b) => b.remainingQuantity - a.remainingQuantity)[0]
  if (!line) throw new Error('the second order has no lines')

  const half = Math.max(1, Math.floor(line.remainingQuantity / 2))
  const partOne = await fulfillOrder(database, {
    organizationId,
    actorUserId,
    orderId: partialOrderId,
    shippedLines: [{ lineId: line.lineId, quantity: half }],
    shippedAt: TODAY,
  })
  if (partOne.isErr()) throw partOne.error
  console.log(
    `RESULT partial1 qty=${half} status=${partOne.value.fulfillmentStatus} ` +
      `post=${partOne.value.post.status} doc=${partOne.value.post.docNumber ?? ''} ` +
      `total=${partOne.value.fulfillment.totalMinor} shipping=${partOne.value.fulfillment.shippingRecognised}`
  )

  const after = await readOrderForFulfillment(database, {
    organizationId,
    orderId: partialOrderId,
  })
  if (after.isErr()) throw after.error
  const rest = after.value.lines.find((row) => row.lineId === line.lineId)?.remainingQuantity ?? 0
  const partTwo = await fulfillOrder(database, {
    organizationId,
    actorUserId,
    orderId: partialOrderId,
    shippedLines: [{ lineId: line.lineId, quantity: rest }],
    shippedAt: TODAY,
  })
  if (partTwo.isErr()) throw partTwo.error
  console.log(
    `RESULT partial2 qty=${rest} status=${partTwo.value.fulfillmentStatus} ` +
      `post=${partTwo.value.post.status} doc=${partTwo.value.post.docNumber ?? ''} ` +
      `total=${partTwo.value.fulfillment.totalMinor} shipping=${partTwo.value.fulfillment.shippingRecognised}`
  )
  console.log(
    `RESULT partialSum=${partOne.value.fulfillment.totalMinor + partTwo.value.fulfillment.totalMinor} orderTotal=${second.value.totalMinor}`
  )

  // ── 5. A payment against an open invoice ─────────────────────────────────
  const invoice = await pickOpenInvoice(organizationId)
  if (invoice) {
    try {
      const paid = await recordManualPayment({
        organizationId,
        userId: actorUserId,
        invoiceInstanceId: invoice.id,
        amount: invoice.balance,
        date: TODAY,
        method: 'check',
        reference: 'CHQ-DRIVE-2G',
      })
      console.log(`RESULT payment tx=${paid.transactionId} amount=${invoice.balance}`)
    } catch (error) {
      console.log(`RESULT payment refused=${(error as Error).message.slice(0, 160)}`)
    }
  } else {
    console.log('RESULT payment=no open invoice to pay')
  }

  // ── 6. The books ─────────────────────────────────────────────────────────
  const balance = await verifyBooksBalance(database, organizationId)
  if (balance.isErr()) throw balance.error
  console.log(
    `RESULT booksBalance balanced=${balance.value.balanced} checked=${balance.value.postingsChecked} ` +
      `discrepancies=${balance.value.discrepancies.length}`
  )

  const tb = await readTrialBalance(database, { organizationId, to: TODAY })
  if (tb.isErr()) throw tb.error
  console.log(
    `RESULT trialBalance balanced=${tb.value.balanced} debit=${tb.value.totalDebitMinor} credit=${tb.value.totalCreditMinor}`
  )
  for (const row of tb.value.rows) {
    console.log(
      `TB ${row.accountCode.padEnd(6)} ${row.accountName.padEnd(34)} ` +
        `Dr ${String(row.debitMinor).padStart(12)}  Cr ${String(row.creditMinor).padStart(12)}`
    )
  }

  await closePools()
  process.exit(0)
}

/**
 * Seed one order with two lines, so the script can run against an org that has
 * none.
 *
 * Deliberately real records through `UnifiedCrudHandler`, not raw inserts: the
 * order-number hook, the totals engine and the relationship link all have to run
 * for the fulfillment path to be exercised the way the app exercises it.
 */
async function seedDemoOrder(
  organizationId: string,
  actorUserId: string,
  // `manual` is seedable on purpose: the drive's first assertion is that the
  // channel table refuses it, so the script has to be able to make one.
  channel: 'dtc' | 'dealer' | 'manual'
): Promise<string> {
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, database)
  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  const lineDefId = await getCachedEntityDefId(organizationId, 'line_item')
  if (!orderDefId || !lineDefId) throw new Error('order or line_item def is missing')

  const order = await crud.create(orderDefId, {
    order_channel: channel,
    order_currency: 'USD',
    order_placed_at: new Date().toISOString(),
  })
  const orderRecordId = toRecordId(orderDefId, order.instance.id)

  await crud.create(lineDefId, {
    line_item_name: 'Auxx-Lift 4x8 platform',
    line_item_qty: 4,
    line_item_unit_price: 125_000,
    line_item_sort_order: 0,
    line_item_order: orderRecordId,
  })
  await crud.create(lineDefId, {
    line_item_name: 'Installation kit',
    line_item_qty: 2,
    line_item_unit_price: 18_500,
    line_item_sort_order: 1,
    line_item_order: orderRecordId,
  })

  await crud.update(orderRecordId, { order_tax_rate: 8, order_shipping_total: 4_500 })
  return order.instance.id
}

/**
 * The first candidate whose biggest line has at least two units left.
 *
 * A one-unit order cannot be shipped in two parts, and half of one unit is one
 * unit - which is what made the first run of this script fulfil the whole order
 * on its "partial" step and then refuse the second, correctly.
 */
async function pickPartialOrder(organizationId: string, candidates: string[]): Promise<string> {
  for (const orderId of candidates) {
    const read = await readOrderForFulfillment(database, { organizationId, orderId })
    if (read.isErr()) continue
    if (read.value.lines.some((line) => line.remainingQuantity >= 2)) return orderId
  }
  throw new Error('no candidate order has a line of two or more units to split')
}

/** Candidate orders with lines and a non-zero total, oldest first. */
async function pickOrders(organizationId: string): Promise<string[]> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['order_total', 'order_line_items', 'order_fulfillments'] as const)
  if (!cf.order_total || !cf.order_line_items) throw new Error('order fields are not provisioned')

  const totals = await database
    .select({ entityId: schema.FieldValue.entityId, total: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, cf.order_total.id)
      )
    )
  const withTotal = totals.filter((row) => (row.total ?? 0) > 0).map((row) => row.entityId)

  const withLines = await database
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, cf.order_line_items.id),
        inArray(schema.FieldValue.entityId, withTotal.slice(0, 400))
      )
    )

  // Skip anything already fulfilled by a previous run of this script.
  const alreadyLogged = cf.order_fulfillments
    ? new Set(
        (
          await database
            .select({ entityId: schema.FieldValue.entityId })
            .from(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.organizationId, organizationId),
                eq(schema.FieldValue.fieldId, cf.order_fulfillments.id)
              )
            )
        ).map((row) => row.entityId)
      )
    : new Set<string>()

  const ids = [...new Set(withLines.map((row) => row.entityId))].filter(
    (id) => !alreadyLogged.has(id)
  )
  return ids.slice(0, 12)
}

/** Ship everything that is left on every line. */
async function allRemaining(
  organizationId: string,
  orderId: string
): Promise<Array<{ lineId: string; quantity: number }>> {
  const read = await readOrderForFulfillment(database, { organizationId, orderId })
  if (read.isErr()) throw read.error
  return read.value.lines
    .filter((line) => line.remainingQuantity > 0)
    .map((line) => ({ lineId: line.lineId, quantity: line.remainingQuantity }))
}

/**
 * Set `order_channel`.
 *
 * A legitimate human write - the field is declared "HUMAN-SET, never derived" -
 * and it is what the seeded data is missing: every DemoOrg1 order carries
 * `manual`, which the channel table refuses so revenue never lands in the wrong
 * half of the P&L by default.
 */
async function setChannel(
  organizationId: string,
  actorUserId: string,
  orderId: string,
  channel: 'dtc' | 'dealer'
): Promise<void> {
  const read = await readOrderForFulfillment(database, { organizationId, orderId })
  if (read.isErr()) throw read.error
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, database)
  await crud.update(read.value.recordId, { order_channel: channel })
}

/** One invoice with a balance left to pay. */
async function pickOpenInvoice(
  organizationId: string
): Promise<{ id: string; balance: number } | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['invoice_balance', 'invoice_status'] as const)
  if (!cf.invoice_balance) return null

  const rows = await database
    .select({ entityId: schema.FieldValue.entityId, balance: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, cf.invoice_balance.id)
      )
    )
    .limit(500)
  const withBalance = rows.filter((row) => (row.balance ?? 0) > 0)
  if (withBalance.length === 0 || !cf.invoice_status) return null

  // A void invoice still carries a balance and `recordManualPayment` refuses it,
  // so the status is part of the pick rather than a surprise at the call.
  const statuses = new Map(
    (
      await database
        .select({ entityId: schema.FieldValue.entityId, optionId: schema.FieldValue.optionId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, cf.invoice_status.id),
            inArray(
              schema.FieldValue.entityId,
              withBalance.map((row) => row.entityId)
            )
          )
        )
    ).map((row) => [row.entityId, row.optionId])
  )
  const open = withBalance.find((row) => {
    const status = statuses.get(row.entityId)
    return status !== 'void' && status !== 'paid'
  })
  return open ? { id: open.entityId, balance: Math.round(open.balance ?? 0) } : null
}

main().catch(async (error) => {
  console.error(error)
  await closePools()
  process.exit(1)
})

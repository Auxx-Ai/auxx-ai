// packages/lib/scripts/drive-fulfillment-posting.ts
//
// Drives plans/money/tasks/49 end to end against a dev org:
//
// 1. reverses every live per-shipment `fulfillment` posting (the 2026-09-04 test
//    postings that debit A/R for Shopify-paid orders, 49 §1.5),
// 2. backfills the three native line fulfillment fields from the Shopify app
//    fields already on the org (what the connector binds on its next sync),
// 3. previews and posts one month per day, reverses one day, shows it come back
//    in the preview, posts it again under an attempt suffix, and shows the
//    month-end close refusing while the day was unposted.
//
// 🛑 Step "derive every connector order's shipment log" is GONE (money plan 55):
// `fulfillment` / `fulfillment_line` are now real entities the Shopify connector
// writes directly (entity migration 153), so there is no log left to derive.
// Re-run the connector sync instead of this script to populate them.
//
// It WRITES real `GlPosting` rows. Point it at a dev org.
//
//   npx dotenv -e ../../.env -- npx tsx scripts/drive-fulfillment-posting.ts <organizationId> <YYYY-MM>

import { closePools, database, schema } from '@auxx/database'
import type { RecordId } from '@auxx/types/resource'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getCachedEntityDefId } from '../src/cache'
import {
  previewFulfillmentPosting,
  runFulfillmentPosting,
} from '../src/money/fulfillment-posting/run'
import { previewMonthEnd, resolvePeriodLock, reverseEntry } from '../src/postings'
import { UnifiedCrudHandler } from '../src/resources/crud/unified-handler'
import { toRecordId } from '../src/resources/resource-id'

const APP_FIELD_TO_NATIVE = {
  fulfilledAt: 'line_item_fulfilled_at',
  fulfilledQuantity: 'line_item_fulfilled_qty',
  shipmentCount: 'line_item_shipment_count',
} as const

async function main() {
  const organizationId = process.argv[2] ?? ''
  const month = process.argv[3] ?? ''
  const previewOnly = process.argv.includes('--preview-only')
  if (!organizationId || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('usage: drive-fulfillment-posting.ts <organizationId> <YYYY-MM>')
  }
  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')
  const actorUserId = member.userId

  if (!previewOnly) {
    await reverseTestPostings(organizationId, actorUserId)
    await backfillNativeLineFacts(organizationId)
  }

  const from = `${month}-01`
  const to = nextMonth(month)
  const request = { organizationId, actorUserId, range: { from, to }, grouping: 'day' as const }

  console.log(`\n=== preview ${month} per day`)
  const preview = await previewFulfillmentPosting(database, request)
  if (preview.isErr()) throw preview.error
  printPlan(preview.value)
  if (previewOnly) {
    for (const e of preview.value.plan.exclusions) console.log('  excluded', e)
    return
  }

  console.log(`\n=== run ${month} per day`)
  const run = await runFulfillmentPosting(database, request)
  printSummary(run)

  const first = run.posted[0]
  if (!first) {
    console.log('nothing posted, stopping')
    return
  }

  console.log(`\n=== reverse ${first.docNumber}`)
  const lock = await resolvePeriodLock(organizationId)
  const reversed = await reverseEntry(database, {
    organizationId,
    glPostingId: first.postingId,
    actorUserId,
    lock,
    memo: 'drive: undo one day',
  })
  console.log(reversed.status, reversed.glPostingId ?? '', reversed.error ?? '')

  console.log(`\n=== preview ${month} again: the reversed day must be back`)
  const again = await previewFulfillmentPosting(database, request)
  if (again.isErr()) throw again.error
  printPlan(again.value)

  console.log(`\n=== month-end preview ${month} while a day is unposted`)
  const closeBlocked = await previewMonthEnd(database, { organizationId, periodKey: month })
  console.log(closeBlocked.blockedBy ?? 'not blocked')

  console.log(`\n=== run ${month} again: the day re-posts under an attempt suffix`)
  const rerun = await runFulfillmentPosting(database, request)
  printSummary(rerun)

  console.log(`\n=== month-end preview ${month} after re-posting`)
  const closeAfter = await previewMonthEnd(database, { organizationId, periodKey: month })
  console.log(closeAfter.blockedBy ?? 'not blocked by revenue')

  const rows = await database
    .select({
      docNumber: schema.GlPosting.docNumber,
      periodKey: schema.GlPosting.periodKey,
      status: schema.GlPosting.status,
      txnDate: schema.GlPosting.txnDate,
      totalMinor: schema.GlPosting.totalMinor,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'fulfillment'),
        sql`${schema.GlPosting.periodKey} !~ '-F[0-9]+$'`
      )
    )
    .orderBy(schema.GlPosting.txnDate)
  console.log(`\n=== batch fulfillment postings now on the org: ${rows.length}`)
  for (const row of rows.slice(0, 8)) console.log(row)
  if (rows.length > 8) console.log(`... ${rows.length - 8} more`)
}

async function reverseTestPostings(organizationId: string, actorUserId: string) {
  // A per-shipment key ends in -F<n>. Its reversal keeps the key, so the net
  // effect of a chain O, R1, R2 ... is live exactly when the LAST posted row sits
  // at an even depth (the original, or a reversal of a reversal). Reverse those.
  const rows = await database
    .select({
      id: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
      status: schema.GlPosting.status,
      reversesId: schema.GlPosting.reversesId,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'fulfillment'),
        sql`${schema.GlPosting.periodKey} ~ '-F[0-9]+$'`
      )
    )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depth = (id: string): number => {
    let d = 0
    let cur = byId.get(id)
    while (cur?.reversesId) {
      d++
      cur = byId.get(cur.reversesId)
    }
    return d
  }
  const live = rows.filter((r) => r.status === 'posted' && depth(r.id) % 2 === 0)
  console.log(`=== reversing ${live.length} net-live per-shipment fulfillment postings`)
  const lock = await resolvePeriodLock(organizationId)
  for (const posting of live) {
    const result = await reverseEntry(database, {
      organizationId,
      glPostingId: posting.id,
      actorUserId,
      lock,
      memo: 'drive: 49 §1.5, per-shipment test posting debiting A/R',
    })
    console.log(`  ${posting.docNumber}: ${result.status}${result.error ? ` ${result.error}` : ''}`)
  }
}

/** Copy the Shopify app fields onto the native line fields, the way the connector's next sync will. */
async function backfillNativeLineFacts(organizationId: string) {
  const lineDefId = await getCachedEntityDefId(organizationId, 'line_item')
  if (!lineDefId) throw new Error('no line_item def')
  const fields = await database
    .select({
      id: schema.CustomField.id,
      appFieldKey: schema.CustomField.appFieldKey,
      appSlug: schema.CustomField.appSlug,
      systemAttribute: schema.CustomField.systemAttribute,
      type: schema.CustomField.type,
    })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, lineDefId)
      )
    )
  const appIds = new Map<string, string>()
  for (const f of fields) {
    if (f.appSlug === 'shopify' && f.appFieldKey && f.appFieldKey in APP_FIELD_TO_NATIVE) {
      appIds.set(f.appFieldKey, f.id)
    }
  }
  if (appIds.size !== 3) {
    console.log(
      `=== no Shopify line fulfillment app fields on this org (${appIds.size}), skipping backfill`
    )
    return
  }
  const values = await database
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueDate: schema.FieldValue.valueDate,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, [...appIds.values()])
      )
    )
  const byLine = new Map<string, Record<string, unknown>>()
  const attrByFieldId = new Map<string, string>()
  for (const [key, id] of appIds)
    attrByFieldId.set(id, APP_FIELD_TO_NATIVE[key as keyof typeof APP_FIELD_TO_NATIVE])
  for (const row of values) {
    const attr = attrByFieldId.get(row.fieldId)
    if (!attr) continue
    const bucket = byLine.get(row.entityId) ?? {}
    bucket[attr] = attr === 'line_item_fulfilled_at' ? row.valueDate : row.valueNumber
    byLine.set(row.entityId, bucket)
  }
  const updates = [...byLine].map(([entityId, v]) => ({
    recordId: toRecordId(lineDefId, entityId) as RecordId,
    values: v,
  }))
  console.log(`=== backfilling native fulfillment facts onto ${updates.length} lines`)
  const handler = new UnifiedCrudHandler(organizationId, 'system', database)
  let updated = 0
  for (let i = 0; i < updates.length; i += 200) {
    const result = await handler.bulkUpdate(updates.slice(i, i + 200), { skipEvents: true })
    updated += result.updated
    if (result.errors.length) console.log('  errors', result.errors.slice(0, 3))
  }
  console.log(`  updated ${updated}`)
}

function printPlan(preview: {
  plan: {
    footer: unknown
    groups: Array<{
      groupKey: string
      txnDate: string
      orderCount: number
      shipments: unknown[]
      totals: unknown
    }>
    exclusions: Array<{ reason: string; detail: string }>
  }
  refusal: string | null
}) {
  if (preview.refusal) console.log('REFUSAL:', preview.refusal)
  console.log('footer', preview.plan.footer)
  for (const g of preview.plan.groups.slice(0, 3)) {
    console.log(
      `  ${g.groupKey} txn ${g.txnDate} orders ${g.orderCount} shipments ${g.shipments.length}`,
      g.totals
    )
  }
  if (preview.plan.groups.length > 3)
    console.log(`  ... ${preview.plan.groups.length - 3} more groups`)
  const byReason = new Map<string, number>()
  for (const e of preview.plan.exclusions) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1)
  console.log('exclusions by reason', Object.fromEntries(byReason))
  for (const e of preview.plan.exclusions.slice(0, 3)) console.log('  ', e)
}

function printSummary(summary: {
  posted: unknown[]
  skipped: unknown[]
  failed: unknown[]
  exclusions: unknown[]
}) {
  console.log(
    `posted ${summary.posted.length} skipped ${summary.skipped.length} failed ${summary.failed.length} excluded ${summary.exclusions.length}`
  )
  for (const p of summary.posted.slice(0, 3)) console.log('  posted', p)
  for (const s of summary.skipped.slice(0, 3)) console.log('  skipped', s)
  for (const f of summary.failed.slice(0, 3)) console.log('  failed', f)
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m!, 1))
  return d.toISOString().slice(0, 10)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closePools())

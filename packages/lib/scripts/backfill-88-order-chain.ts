// packages/lib/scripts/backfill-88-order-chain.ts
//
// One-time backfill for 88 §4.5 on a dev org: approve every receipt draft
// (each approval continues its order's chain, D10), then run the shipment,
// movement and channel-memo sweeps until they find nothing, and re-count.
//
// Run from the repo root:
//   npx dotenv -- npx tsx packages/lib/scripts/backfill-88-order-chain.ts --org <organizationId>

import { database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { resolvePeriodLock } from '../src/accounting/ledger/periods/period-lock'
import { postDraft } from '../src/accounting/ledger/post/post-entry'
import { sweepMovementAccounting } from '../src/accounting/money/blocked-movements'
import { sweepChannelCreditMemos } from '../src/accounting/sales/credit-memos/issue-pass'
import { sweepFulfillmentAccounting } from '../src/accounting/sales/fulfillments/accounting-sweep'
import { continueAccountingAfterDraft } from '../src/accounting/sales/orders/continue-accounting'
import { getOrgCache } from '../src/cache'
import { runPendingDataMigrations } from '../src/data-migrations/run-pending-data-migrations'

const ORG = (() => {
  const at = process.argv.indexOf('--org')
  const value = at === -1 ? undefined : process.argv[at + 1]
  if (!value) throw new Error('--org <organizationId> is required')
  return value
})()

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await database.execute(query)
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[]
}

async function count(): Promise<void> {
  const [postings, blockedMovements, blockedShipments, unposted] = await Promise.all([
    rows<{ postingType: string; status: string; count: number }>(sql`
      SELECT "postingType", status, count(*)::int AS count FROM "GlPosting"
      WHERE "organizationId" = ${ORG} GROUP BY 1, 2 ORDER BY 1, 2`),
    rows<{ purpose: string; reason: string; count: number }>(sql`
      SELECT purpose, left("postingBlockedReason", 70) AS reason, count(*)::int AS count
      FROM "MoneyTransaction" m
      WHERE "organizationId" = ${ORG} AND "postingBlockedReason" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" l WHERE l."organizationId" = m."organizationId"
          AND l."sourceKind" = 'money_transaction' AND l."sourceId" = m.id AND l."linkRole" = 'subject')
      GROUP BY 1, 2 ORDER BY 3 DESC`),
    rows<{ kind: string; count: number }>(sql`
      SELECT CASE WHEN fv."valueText" LIKE '%earlier receipt%' THEN 'earlier receipt pending'
                  WHEN fv."valueText" LIKE '%earlier shipment%' THEN 'earlier shipment pending'
                  WHEN fv."valueText" LIKE '%draft awaiting%' THEN 'waiting on a draft'
                  ELSE left(fv."valueText", 70) END AS kind, count(*)::int AS count
      FROM "FieldValue" fv JOIN "CustomField" cf ON cf.id = fv."fieldId"
      WHERE fv."organizationId" = ${ORG} AND cf."systemAttribute" = 'fulfillment_posting_blocked_reason'
        AND fv."valueText" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" l WHERE l."organizationId" = fv."organizationId"
          AND l."sourceKind" = 'fulfillment' AND l."sourceId" = fv."entityId" AND l."linkRole" = 'subject')
      GROUP BY 1 ORDER BY 2 DESC`),
    rows<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM "FieldValue" ship JOIN "CustomField" cf ON cf.id = ship."fieldId"
      WHERE ship."organizationId" = ${ORG} AND cf."systemAttribute" = 'fulfillment_shipped_at'
        AND ship."valueDate" > '2026-02-01'
        AND NOT EXISTS (SELECT 1 FROM "GlPostingSource" l WHERE l."organizationId" = ship."organizationId"
          AND l."sourceKind" = 'fulfillment' AND l."sourceId" = ship."entityId" AND l."linkRole" = 'subject')`),
  ])
  console.log('postings', postings)
  console.log('blocked movements', blockedMovements)
  console.log('blocked shipments', blockedShipments)
  console.log('live shipments after the cutoff with no claim', unposted[0]?.count)
}

async function approveReceiptDrafts(userId: string): Promise<void> {
  const drafts = await rows<{ id: string }>(sql`
    SELECT id FROM "GlPosting" WHERE "organizationId" = ${ORG} AND status = 'draft'
      AND "postingType" = 'payment' ORDER BY "txnDate" ASC, "createdAt" ASC`)
  console.log(`${drafts.length} receipt drafts to approve`)
  const outcomes: Record<string, number> = {}
  let done = 0
  for (const { id } of drafts) {
    const lock = await resolvePeriodLock(ORG)
    const result = await postDraft(database, {
      organizationId: ORG,
      glPostingId: id,
      actorUserId: userId,
      lock,
    })
    outcomes[result.status] = (outcomes[result.status] ?? 0) + 1
    if (result.status === 'posted')
      await continueAccountingAfterDraft(database, {
        organizationId: ORG,
        glPostingId: id,
        actorUserId: userId,
      })
    if (++done % 100 === 0) console.log(`  ${done}/${drafts.length}`, outcomes)
  }
  console.log('approvals', outcomes)
}

async function drain<T extends { scanned: number }>(label: string, pass: () => Promise<T>) {
  for (let round = 1; round <= 40; round++) {
    const counts = await pass()
    console.log(`${label} round ${round}`, counts)
    if (counts.scanned === 0) break
  }
}

/** `--memos-only`: clear the "waits on its order" markers and drain the memo pass again. */
const MEMOS_ONLY = process.argv.includes('--memos-only')

async function main(): Promise<void> {
  if (MEMOS_ONLY) {
    await database.execute(sql`
      UPDATE "FieldValue" SET "valueDate" = NULL
      WHERE "organizationId" = ${ORG}
        AND "fieldId" IN (SELECT id FROM "CustomField" WHERE "organizationId" = ${ORG}
          AND "systemAttribute" = 'credit_memo_issue_blocked_at')
        AND "entityId" IN (SELECT "entityId" FROM "FieldValue" r
          WHERE r."organizationId" = ${ORG} AND (r."valueText" IS NULL OR r."valueText" LIKE 'This credit memo waits on its order:%')
            AND r."fieldId" IN (SELECT id FROM "CustomField" WHERE "organizationId" = ${ORG}
              AND "systemAttribute" = 'credit_memo_issue_blocked_reason'))`)
    await database.execute(sql`
      UPDATE "FieldValue" SET "valueText" = NULL
      WHERE "organizationId" = ${ORG} AND "valueText" LIKE 'This credit memo waits on its order:%'
        AND "fieldId" IN (SELECT id FROM "CustomField" WHERE "organizationId" = ${ORG}
          AND "systemAttribute" = 'credit_memo_issue_blocked_reason')`)
    await drain('memos', () =>
      sweepChannelCreditMemos(database, { organizationId: ORG, limit: 500 })
    )
    await drain('movements', () =>
      sweepMovementAccounting(database, { organizationId: ORG, limit: 500 })
    )
    console.log('--- after')
    await count()
    return
  }
  console.log('migrations', await runPendingDataMigrations(database))
  console.log('--- before')
  await count()
  const userId = await getOrgCache().get(ORG, 'systemUser')
  await approveReceiptDrafts(userId)
  await drain('shipments', () =>
    sweepFulfillmentAccounting(database, { organizationId: ORG, limit: 500 })
  )
  await drain('movements', () =>
    sweepMovementAccounting(database, { organizationId: ORG, limit: 500 })
  )
  await drain('memos', () => sweepChannelCreditMemos(database, { organizationId: ORG, limit: 500 }))
  await drain('movements again', () =>
    sweepMovementAccounting(database, { organizationId: ORG, limit: 500 })
  )
  await drain('shipments again', () =>
    sweepFulfillmentAccounting(database, { organizationId: ORG, limit: 500 })
  )
  console.log('--- after')
  await count()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

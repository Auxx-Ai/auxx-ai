// packages/lib/scripts/drive-fulfillment-posting-preview.ts
//
// READ-ONLY. Drives the real bulk-fulfillment plan for one month and reports
// what it WOULD post: the debit split, the exclusions, and - the point of the
// script - whether every account each group names actually resolves.
//
// Written to answer "the close says 439 shipments are unposted; what happens if
// I post them?" without posting them. `previewFulfillmentPosting` is the same
// call the dialog makes, and `resolveAccountLines` is the same door
// `postEntry` walks, so a refusal here is the refusal the real post would give.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-fulfillment-posting-preview.ts <organizationId> <YYYY-MM>

import { closePools, database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { previewFulfillmentPosting } from '../src/money/fulfillment-posting'
import { listPaymentGateways } from '../src/payment-gateways'
import { buildFulfillmentBatchEntry } from '../src/postings/build-fulfillment-batch-entry'
import { resolveAccountLines } from '../src/postings/resolve-roles'

function usd(minor: number): string {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

async function main() {
  const organizationId = process.argv[2]
  const month = process.argv[3]
  if (!organizationId || !month) {
    throw new Error('usage: drive-fulfillment-posting-preview.ts <organizationId> <YYYY-MM>')
  }

  // `previewFulfillmentPosting` wants an actor even though it writes nothing.
  const [member] = await database
    .select({ userId: schema.OrganizationMember.userId })
    .from(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.organizationId, organizationId))
    .limit(1)
  if (!member) throw new Error('that organization has no members')

  // ── The gateway records, because they decide every clearing debit ─────────
  const gateways = await listPaymentGateways(database, organizationId, { includeArchived: true })
  if (gateways.isErr()) throw gateways.error
  console.log(`\n=== payment_gateway records (${gateways.value.length}) ===`)
  for (const gw of gateways.value) {
    console.log(
      `  ${gw.name}: handles=[${gw.handles.join(', ')}] clearing=${gw.clearingGlAccountId} ` +
        `settlement=${gw.settlementSource} status=${gw.status}`
    )
  }

  // ── The plan, exactly as the dialog builds it ─────────────────────────────
  const preview = await previewFulfillmentPosting(database, {
    organizationId,
    range: { from: `${month}-01`, to: `${month}-31` },
    grouping: 'month',
    actorUserId: member.userId,
  })
  if (preview.isErr()) throw preview.error
  const { plan, refusal } = preview.value
  if (refusal) console.log(`\n  REFUSAL: ${refusal}`)

  console.log(`\n=== plan for ${month} ===`)
  console.log(
    `  postings=${plan.footer.postings} shipments=${plan.footer.shipments} ` +
      `orders=${plan.footer.orders} excluded=${plan.footer.excluded} total=${usd(plan.footer.totalMinor)}`
  )
  for (const ex of plan.exclusions.slice(0, 10)) {
    console.log(`  EXCLUDED ${ex.orderNumber}: ${ex.reason} - ${ex.detail}`)
  }

  // ── What each group would actually post, and whether it resolves ──────────
  for (const group of plan.groups) {
    console.log(`\n=== group ${group.groupKey} (${group.shipments.length} shipments) ===`)
    console.log(`  total=${usd(group.totals.totalMinor)}`)
    for (const [role, amount] of Object.entries(group.totals.byDebitRole)) {
      if (amount !== 0) console.log(`  debit ${role}: ${usd(amount as number)}`)
    }

    // The distinct id-based debits, which bypass the role table entirely.
    const byAccount = new Map<string, number>()
    for (const s of group.shipments) {
      const id = s.amounts.debitGlAccountId
      if (id) byAccount.set(id, (byAccount.get(id) ?? 0) + s.amounts.totalMinor)
    }
    for (const [id, amount] of byAccount) {
      console.log(`  debit BY ID ${id}: ${usd(amount)}`)
    }

    let built: ReturnType<typeof buildFulfillmentBatchEntry>
    try {
      built = buildFulfillmentBatchEntry({ group, ledgerCurrency: 'USD', attempt: 0 })
    } catch (error) {
      console.log(`  🛑 BUILD REFUSED: ${(error as Error).message}`)
      continue
    }

    console.log(
      `  lines=${built.entry.lines.length} balanced=${
        built.entry.totalDebit === built.entry.totalCredit
      } (${usd(built.entry.totalDebit)})`
    )

    // 🛑 The real test. `postEntry` calls this exact function, so a problem
    // here is a problem the post would hit.
    const resolved = await resolveAccountLines(database, organizationId, built.entry.lines)
    if (resolved.isErr()) {
      console.log(
        `  🛑 WOULD REFUSE TO POST:\n     ${resolved.error.message.replace(/\n/g, '\n     ')}`
      )
    } else {
      console.log('  ✅ every account resolves - this group would post')
      for (const account of resolved.value) {
        console.log(`     ${account.code ?? '(no code)'} ${account.name}`)
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closePools)

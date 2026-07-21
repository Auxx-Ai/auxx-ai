// apps/worker/scripts/verify-money-early-convert.ts
/**
 * Money plan 20 (early job from quote — convert before acceptance) integration verification
 * (plans/dispatch/money/20-early-job-from-quote.md §5). Exercises the real write paths —
 * `convertQuoteToWorkOrder` (relaxed draft/sent/approved gate + one-active-job guard +
 * `line_item_source_line` provenance stamp), `acceptQuoteByToken`'s existing-job branch
 * (skip-create + deposit stamp + review-variant notification + `linkedExistingJob`), and
 * `declineQuoteByToken`'s job-reference suffix — end to end against the live dev DB.
 *
 * SAFETY: same posture as verify-money-line-pricing.ts — `acceptQuoteByToken`/
 * `declineQuoteByToken`'s only side-notification path is `notifyQuoteCreator` →
 * `NotificationService.sendNotification`, which is DB-insert + realtime-publish ONLY (no
 * email/queue path exists). Nothing Stripe-shaped is called; the one PaymentTransaction row
 * is a synthetic `manual` ledger insert this script deletes in cleanup.
 *
 * Org settings this script depends on (`documents.quote.acceptancePageEnabled`,
 * `documents.quote.autoConvertOnAccept`, `documents.quote.allowDecline`) are read first and
 * flipped on only if found off, with byte-exact restore in `finally` (line-pricing recipe).
 *
 * Creates records prefixed "[EC-verify]" and deletes/reverts everything in a try/finally.
 * Cleanup order: notifications + payment txns (raw rows) → lines → work orders → quotes →
 * contact (work orders BEFORE quotes — the quote pre-delete guard mirrors the active-job
 * lookup).
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -- node --conditions source --import tsx/esm \
 *     scripts/verify-money-early-convert.ts
 */

import { database, schema } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import {
  acceptQuoteByToken,
  convertQuoteToWorkOrder,
  declineQuoteByToken,
  ensureQuotePublicToken,
  markQuoteSent,
} from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { ALL_ENTITY_MIGRATIONS } from '@auxx/lib/seed/entity-migrations'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

/** Run `fn`, expecting it to throw. Returns the caught error (or `undefined` if it didn't). */
async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function entityDefId(organizationId: string, entityType: string) {
  const def = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, entityType)),
  })
  return def?.id ?? null
}

async function fieldId(organizationId: string, entityType: string, systemAttribute: string) {
  const defId = await entityDefId(organizationId, entityType)
  if (!defId) return null
  const field = await database.query.CustomField.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.entityDefinitionId, defId), eq(t.systemAttribute, systemAttribute)),
  })
  return field?.id ?? null
}

/** Read one `FieldValue` row by (entityType, instanceId, systemAttribute). `null` when unset. */
async function fieldValueByAttr(
  organizationId: string,
  entityType: string,
  instanceId: string,
  systemAttribute: string
) {
  const fid = await fieldId(organizationId, entityType, systemAttribute)
  if (!fid) return null
  const fv = await database.query.FieldValue.findFirst({
    where: (t, { and, eq }) => and(eq(t.entityId, instanceId), eq(t.fieldId, fid)),
  })
  return fv ?? null
}

/** `line_item` instance ids on a work order. */
async function lineIdsForWorkOrder(handler: UnifiedCrudHandler, workOrderRecordId: unknown) {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'f',
        logicalOperator: 'AND',
        conditions: [
          { id: 'c', fieldId: 'line_item:workOrder', operator: 'is', value: workOrderRecordId },
        ],
      },
    ],
    limit: 200,
    mode: 'oneshot',
  })
  return ids
}

/** `work_order` instance ids linked to a given quote (all statuses). */
async function workOrderIdsForQuote(handler: UnifiedCrudHandler, quoteRecordId: unknown) {
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'work_order',
    filters: [
      {
        id: 'f',
        logicalOperator: 'AND',
        conditions: [
          { id: 'c', fieldId: 'work_order:quote', operator: 'is', value: quoteRecordId },
        ],
      },
    ],
    limit: 10,
    mode: 'oneshot',
  })
  return ids
}

/** Newest notification message for a quote instance, or null. */
async function latestNotificationMessage(organizationId: string, quoteInstanceId: string) {
  const row = await database.query.Notification.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.organizationId, organizationId),
        eq(t.entityType, 'quote'),
        eq(t.entityId, quoteInstanceId)
      ),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })
  return row?.message ?? null
}

async function main() {
  const user = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!user) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org)
  const userId = user.id
  console.log(`Org ${organizationId}, user ${userId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const createdContactIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdLineIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdPaymentTransactionIds: string[] = []

  // ── Defensive org-settings guard (byte-exact restore) ────────────────────────
  const settingKeys = [
    'documents.quote.acceptancePageEnabled',
    'documents.quote.autoConvertOnAccept',
    'documents.quote.allowDecline',
  ] as const
  const overridden: Array<{ key: (typeof settingKeys)[number]; original: unknown }> = []

  try {
    for (const key of settingKeys) {
      const original = await getOrganizationSetting({ organizationId, key })
      if (original === false) {
        await updateOrganizationSetting({ organizationId, key, value: true })
        await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
        overridden.push({ key, original })
      }
    }

    // Migration 047 must have run for the provenance stamp to have a field to land on.
    // It's idempotent, so applying it here doubles as the §5 idempotency check setup.
    const migration047 = ALL_ENTITY_MIGRATIONS.find((m) => m.id === '047-line-item-source-line')
    if (!migration047) throw new Error('Migration 047 not found in registry')
    await migration047.up(database, organizationId)
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields'])

    const contact = await handler.create('contact', {
      first_name: '[EC-verify]',
      last_name: 'Test Customer',
      primary_email: 'ec-verify@example.com',
    })
    createdContactIds.push(contact.instance.id)
    const contactRecordId = toRecordId('contact', contact.instance.id)

    async function seedQuote(title: string, opts?: { withOptional?: boolean }) {
      const quote = await handler.create('quote', {
        quote_title: title,
        quote_contact: contactRecordId,
      })
      createdQuoteIds.push(quote.instance.id)
      const required = await handler.create('line_item', {
        line_item_name: '[EC-verify] Required line',
        line_item_qty: 1,
        line_item_unit_price: 10000,
        line_item_taxable: false,
        line_item_quote: quote.recordId,
      })
      createdLineIds.push(required.instance.id)
      let optional: Awaited<ReturnType<typeof handler.create>> | undefined
      if (opts?.withOptional) {
        optional = await handler.create('line_item', {
          line_item_name: '[EC-verify] Optional line (pre-checked)',
          line_item_qty: 1,
          line_item_unit_price: 5000,
          line_item_taxable: false,
          line_item_optional: true,
          line_item_optional_selected: true,
          line_item_quote: quote.recordId,
        })
        createdLineIds.push(optional.instance.id)
      }
      return { quote, required, optional }
    }

    // ══════════════════════════════════════════════════════════════════════
    // A. Convert gate + guard + provenance (plan §5.1–§5.3)
    // ══════════════════════════════════════════════════════════════════════
    console.log('A: convert gate + guard + provenance')

    // A.1 — early convert straight from DRAFT.
    const a = await seedQuote('[EC-verify] Draft-convert quote')
    const woA1 = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: a.quote.instance.id,
    })
    createdWorkOrderIds.push(woA1.instance.id)
    check('A1: convert on a draft quote succeeds', !!woA1.instance.id)

    // A.2 — copied line carries source-line provenance.
    const woA1LineIds = await lineIdsForWorkOrder(handler, woA1.recordId)
    createdLineIds.push(...woA1LineIds)
    check('A2: exactly one copied line on the job', woA1LineIds.length === 1, woA1LineIds)
    const a2Provenance = await fieldValueByAttr(
      organizationId,
      'line_item',
      woA1LineIds[0]!,
      'line_item_source_line'
    )
    check(
      'A2: copy stamped line_item_source_line = source quote-line instance id',
      a2Provenance?.valueText === a.required.instance.id,
      a2Provenance?.valueText
    )

    // A.3 — one-active-job guard rejects a second convert.
    const a3Err = await expectThrow(() =>
      convertQuoteToWorkOrder({ organizationId, userId, quoteInstanceId: a.quote.instance.id })
    )
    check(
      'A3: second convert rejected (active job exists)',
      !!a3Err && errMessage(a3Err).includes('already been converted'),
      a3Err && errMessage(a3Err)
    )

    // A.4 — canceled jobs don't count: cancel, convert again succeeds.
    await handler.update(toRecordId('work_order', woA1.instance.id), {
      work_order_status: 'canceled',
    })
    const woA4 = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: a.quote.instance.id,
    })
    createdWorkOrderIds.push(woA4.instance.id)
    createdLineIds.push(...(await lineIdsForWorkOrder(handler, woA4.recordId)))
    check('A4: convert succeeds again after the job is canceled', !!woA4.instance.id)

    // A.5 — declined quote rejects.
    const a5 = await seedQuote('[EC-verify] Declined quote')
    await markQuoteSent({ organizationId, userId, quoteInstanceId: a5.quote.instance.id })
    const a5Token = await ensureQuotePublicToken(organizationId, a5.quote.instance.id)
    await declineQuoteByToken(a5Token)
    const a5Err = await expectThrow(() =>
      convertQuoteToWorkOrder({ organizationId, userId, quoteInstanceId: a5.quote.instance.id })
    )
    check(
      'A5: convert on a declined quote rejects with the status message',
      !!a5Err && errMessage(a5Err).includes("quote is 'declined'"),
      a5Err && errMessage(a5Err)
    )

    // A.6 — canceled quote rejects (canceled is freely settable, per the quote status hook).
    const a6 = await seedQuote('[EC-verify] Canceled quote')
    await handler.update(a6.quote.recordId, { quote_status: 'canceled' })
    const a6Err = await expectThrow(() =>
      convertQuoteToWorkOrder({ organizationId, userId, quoteInstanceId: a6.quote.instance.id })
    )
    check(
      'A6: convert on a canceled quote rejects with the status message',
      !!a6Err && errMessage(a6Err).includes("quote is 'canceled'"),
      a6Err && errMessage(a6Err)
    )

    // ══════════════════════════════════════════════════════════════════════
    // B. Accept with an existing early job (plan §5.4)
    // ══════════════════════════════════════════════════════════════════════
    console.log('B: accept with existing early job')

    const b = await seedQuote('[EC-verify] Early-then-accept quote')
    await markQuoteSent({ organizationId, userId, quoteInstanceId: b.quote.instance.id })
    const woB = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: b.quote.instance.id,
    })
    createdWorkOrderIds.push(woB.instance.id)
    createdLineIds.push(...(await lineIdsForWorkOrder(handler, woB.recordId)))
    check('B0: early convert from SENT succeeds', !!woB.instance.id)

    // Synthetic pre-paid deposit: quote-linked succeeded charge with no work order yet
    // (the shape `createStripeDepositCheckout` leaves behind pre-convert).
    const [depositTxn] = await database
      .insert(schema.PaymentTransaction)
      .values({
        organizationId,
        provider: 'manual',
        kind: 'charge',
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        quoteInstanceId: b.quote.instance.id,
        createdByUserId: userId,
      })
      .returning({ id: schema.PaymentTransaction.id })
    createdPaymentTransactionIds.push(depositTxn!.id)

    const bToken = await ensureQuotePublicToken(organizationId, b.quote.instance.id)
    const bResult = await acceptQuoteByToken(bToken, { name: 'Verify Customer' })
    check(
      'B1: accept with existing job — converted:false, linkedExistingJob:true',
      bResult.alreadyAccepted === false &&
        bResult.converted === false &&
        bResult.linkedExistingJob === true,
      bResult
    )

    const bJobIds = await workOrderIdsForQuote(handler, b.quote.recordId)
    check('B2: still exactly one job for the quote (no duplicate)', bJobIds.length === 1, bJobIds)

    const bTxnAfter = await database.query.PaymentTransaction.findFirst({
      where: (t, { eq }) => eq(t.id, depositTxn!.id),
    })
    check(
      'B3: deposit txn stamped onto the existing job at accept',
      bTxnAfter?.workOrderInstanceId === woB.instance.id,
      bTxnAfter?.workOrderInstanceId
    )

    const bMessage = await latestNotificationMessage(organizationId, b.quote.instance.id)
    check(
      'B4: notification is the review variant (no selection delta)',
      !!bMessage?.includes('already exists; review its line items'),
      bMessage
    )

    const bStatus = await fieldValueByAttr(
      organizationId,
      'quote',
      b.quote.instance.id,
      'quote_status'
    )
    check('B5: quote is approved', bStatus?.optionId === 'approved', bStatus?.optionId)

    // ══════════════════════════════════════════════════════════════════════
    // C. Accept-time selection change flags drift, never edits the job (plan §2.3/§5.4)
    // ══════════════════════════════════════════════════════════════════════
    console.log('C: selection-changed variant + snapshot untouched')

    const c = await seedQuote('[EC-verify] Selection-change quote', { withOptional: true })
    await markQuoteSent({ organizationId, userId, quoteInstanceId: c.quote.instance.id })
    const woC = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: c.quote.instance.id,
    })
    createdWorkOrderIds.push(woC.instance.id)
    const woCLinesBefore = await lineIdsForWorkOrder(handler, woC.recordId)
    createdLineIds.push(...woCLinesBefore)
    check(
      'C0: early job snapshot copied required + pre-checked optional (2 lines)',
      woCLinesBefore.length === 2,
      woCLinesBefore
    )

    const cToken = await ensureQuotePublicToken(organizationId, c.quote.instance.id)
    const cResult = await acceptQuoteByToken(cToken, {
      name: 'Verify Customer',
      selectedLineIds: [], // explicit deselect-all — a real selection change
    })
    check(
      'C1: accept with existing job — linkedExistingJob:true',
      cResult.linkedExistingJob === true && cResult.converted === false,
      cResult
    )
    const cMessage = await latestNotificationMessage(organizationId, c.quote.instance.id)
    check(
      'C2: notification is the selection-changed variant',
      !!cMessage?.includes('option selection changed'),
      cMessage
    )
    const woCLinesAfter = await lineIdsForWorkOrder(handler, woC.recordId)
    check(
      'C3: job line snapshot untouched by acceptance (still 2 lines)',
      woCLinesAfter.length === 2,
      woCLinesAfter
    )
    const cOptionalFlag = await fieldValueByAttr(
      organizationId,
      'line_item',
      c.optional!.instance.id,
      'line_item_optional_selected'
    )
    check(
      'C4: QUOTE optional line deselected by the submitted selection',
      cOptionalFlag?.valueBoolean === false,
      cOptionalFlag?.valueBoolean
    )

    // ══════════════════════════════════════════════════════════════════════
    // D. Accept with NO job — fresh auto-convert unchanged (plan §5.5)
    // ══════════════════════════════════════════════════════════════════════
    console.log('D: fresh auto-convert on accept')

    const d = await seedQuote('[EC-verify] Fresh-convert quote')
    await markQuoteSent({ organizationId, userId, quoteInstanceId: d.quote.instance.id })
    const dToken = await ensureQuotePublicToken(organizationId, d.quote.instance.id)
    const dResult = await acceptQuoteByToken(dToken, { name: 'Verify Customer' })
    check(
      'D1: accept with no job — converted:true, linkedExistingJob:false',
      dResult.converted === true && dResult.linkedExistingJob === false,
      dResult
    )
    const dJobIds = await workOrderIdsForQuote(handler, d.quote.recordId)
    createdWorkOrderIds.push(...dJobIds)
    check('D1: exactly one job created', dJobIds.length === 1, dJobIds)
    const dJobLineIds = await lineIdsForWorkOrder(handler, toRecordId('work_order', dJobIds[0]!))
    createdLineIds.push(...dJobLineIds)
    const dProvenance = await fieldValueByAttr(
      organizationId,
      'line_item',
      dJobLineIds[0]!,
      'line_item_source_line'
    )
    check(
      'D2: auto-converted copy carries source-line provenance',
      dProvenance?.valueText === d.required.instance.id,
      dProvenance?.valueText
    )
    const dMessage = await latestNotificationMessage(organizationId, d.quote.instance.id)
    check(
      'D3: notification is the plain accepted message (no review suffix)',
      !!dMessage?.includes('accepted quote') && !dMessage.includes('review'),
      dMessage
    )

    // ══════════════════════════════════════════════════════════════════════
    // E. Decline with an existing early job (plan §5.6)
    // ══════════════════════════════════════════════════════════════════════
    console.log('E: decline with existing early job')

    const e = await seedQuote('[EC-verify] Early-then-decline quote')
    await markQuoteSent({ organizationId, userId, quoteInstanceId: e.quote.instance.id })
    const woE = await convertQuoteToWorkOrder({
      organizationId,
      userId,
      quoteInstanceId: e.quote.instance.id,
    })
    createdWorkOrderIds.push(woE.instance.id)
    createdLineIds.push(...(await lineIdsForWorkOrder(handler, woE.recordId)))

    const eToken = await ensureQuotePublicToken(organizationId, e.quote.instance.id)
    const eResult = await declineQuoteByToken(eToken, { reason: 'Too expensive' })
    check('E1: decline succeeds', eResult.alreadyDeclined === false, eResult)
    const eMessage = await latestNotificationMessage(organizationId, e.quote.instance.id)
    check(
      'E2: decline notification carries the existing-job reference',
      !!eMessage?.includes('exists for this quote'),
      eMessage
    )
    const eJobStatus = await fieldValueByAttr(
      organizationId,
      'work_order',
      woE.instance.id,
      'work_order_status'
    )
    check(
      'E3: job untouched by decline (never auto-canceled)',
      eJobStatus?.optionId !== 'canceled',
      eJobStatus?.optionId
    )

    // ══════════════════════════════════════════════════════════════════════
    // F. Migration 047 idempotency (plan §5)
    // ══════════════════════════════════════════════════════════════════════
    console.log('F: migration idempotency')
    const migrationRun1 = await migration047.up(database, organizationId)
    check(
      'F1: migration 047 re-run #1 is alreadyUpToDate',
      migrationRun1.alreadyUpToDate === true,
      migrationRun1
    )
    const migrationRun2 = await migration047.up(database, organizationId)
    check(
      'F1: migration 047 re-run #2 is alreadyUpToDate',
      migrationRun2.alreadyUpToDate === true,
      migrationRun2
    )
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdPaymentTransactionIds.length} payment txns, ` +
        `${createdLineIds.length} lines, ${createdWorkOrderIds.length} work orders, ` +
        `${createdQuoteIds.length} quotes, ${createdContactIds.length} contacts`
    )
    // Raw deletes — apps/worker has no direct drizzle-orm dependency (route-planner script
    // precedent), so operator-needing writes go through the pg client.
    if (createdPaymentTransactionIds.length > 0) {
      await database.$client.query('DELETE FROM "PaymentTransaction" WHERE id = ANY($1)', [
        createdPaymentTransactionIds,
      ])
    }
    if (createdQuoteIds.length > 0) {
      await database.$client.query(
        `DELETE FROM "Notification" WHERE "organizationId" = $1 AND "entityType" = 'quote' AND "entityId" = ANY($2)`,
        [organizationId, createdQuoteIds]
      )
    }
    for (const id of [...new Set(createdLineIds)]) {
      try {
        await handler.delete(toRecordId('line_item', id))
      } catch (err) {
        console.log(`  cleanup failed for line_item:${id}:`, errMessage(err))
      }
    }
    for (const id of [...new Set(createdWorkOrderIds)]) {
      try {
        await handler.delete(toRecordId('work_order', id))
      } catch (err) {
        console.log(`  cleanup failed for work_order:${id}:`, errMessage(err))
      }
    }
    for (const id of [...new Set(createdQuoteIds)]) {
      try {
        await handler.delete(toRecordId('quote', id))
      } catch (err) {
        console.log(`  cleanup failed for quote:${id}:`, errMessage(err))
      }
    }
    for (const id of [...new Set(createdContactIds)]) {
      try {
        await handler.delete(toRecordId('contact', id))
      } catch (err) {
        console.log(`  cleanup failed for contact:${id}:`, errMessage(err))
      }
    }
    for (const { key, original } of overridden) {
      await updateOrganizationSetting({ organizationId, key, value: original })
      await getOrgCache().invalidateAndRecompute(organizationId, ['orgSettings'])
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

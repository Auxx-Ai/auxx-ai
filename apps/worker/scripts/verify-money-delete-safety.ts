// apps/worker/scripts/verify-money-delete-safety.ts
/**
 * Money delete-safety verification (plans/dispatch/money/12-delete-safety.md, "Build order &
 * verification" §verify script). Exercises the server-side pre-delete hooks that make
 * `UnifiedCrudHandler.delete`/`bulkDelete` (the same path generic `record.delete`/`bulkDelete`
 * and the table/bulk UI use) safe for invoices, work orders, and quotes:
 *
 *   - invoice hook (§A): admin gate -> succeeded/disputed-charge guard -> purge pending/failed
 *     ledger residue -> unstamp WO source lines -> hard-delete invoice-owned line copies.
 *   - work_order hook (§C): admin gate -> reject if any invoice is linked (direct
 *     `invoice_work_order` rel OR a stamped `line_item_invoice` line) -> clean up WO-owned
 *     lines (visits/QC/recurrence cascade at the DB level, by design).
 *   - quote hook (§F): reject deleting a quote with a linked non-canceled work order (mirrors
 *     the `convertQuoteToWorkOrder` one-job-per-quote predicate). No admin gate.
 *
 * Manual payments only (`recordManualPayment` from the ledger, plus raw-inserted
 * pending/failed/disputed rows to simulate ledger residue) — never touches Stripe. Never calls
 * `dispatchVisit` (the real email rail) — work orders are created
 * via `UnifiedCrudHandler.create('work_order', ...)`, which already auto-creates exactly one
 * `WorkOrderVisit` row via the `ensureVisitOnWorkOrderCreate` field hook (no manual visit
 * creation needed).
 *
 * Creates records prefixed "[MDS-verify]" and deletes/reverts everything in a try/finally,
 * including a temporary `OrganizationMember` row used to drive the non-admin ("member")
 * delete-rejection checks.
 *
 * Run (from repo root) under the worker runtime:
 *   node --conditions source --env-file .env --import tsx/esm \
 *     apps/worker/scripts/verify-money-delete-safety.ts
 */

import { database, schema } from '@auxx/database'
import { getOrgCache } from '@auxx/lib/cache'
import { AuxxError } from '@auxx/lib/errors'
import { deleteInvoice, listUninvoicedLines, recordManualPayment } from '@auxx/lib/money'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { generateId } from '@auxx/utils'

/** Build a RecordId string without pulling in `@auxx/types` (not a worker dependency). */
function toRecordId(entityDefinitionId: string, entityInstanceId: string) {
  return `${entityDefinitionId}:${entityInstanceId}` as never
}

let pass = 0
let fail = 0
let checkIndex = 0
function check(name: string, ok: boolean, detail?: unknown) {
  checkIndex++
  if (ok) {
    pass++
    console.log(`  ✅ [${checkIndex}] ${name}`)
  } else {
    fail++
    console.log(`  ❌ [${checkIndex}] ${name}`, detail ?? '')
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

async function instanceExists(instanceId: string): Promise<boolean> {
  const row = await database.query.EntityInstance.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.id, instanceId),
  })
  return !!row
}

async function countPaymentTransactions(invoiceInstanceId: string): Promise<number> {
  const rows = await database.query.PaymentTransaction.findMany({
    columns: { id: true },
    where: (t, { eq }) => eq(t.invoiceInstanceId, invoiceInstanceId),
  })
  return rows.length
}

async function countVisits(workOrderInstanceId: string): Promise<number> {
  const rows = await database.query.WorkOrderVisit.findMany({
    columns: { id: true },
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  return rows.length
}

/**
 * Raw-insert a `PaymentTransaction` row bypassing `recordManualPayment` (which always inserts
 * `status: 'succeeded'`) — the only way to fabricate the pending/failed/disputed residue
 * scenarios this hook must handle (finding 3 in the plan: an abandoned-checkout invoice with
 * only non-succeeded ledger rows).
 */
async function insertRawPaymentTransaction(params: {
  organizationId: string
  invoiceInstanceId: string
  status: 'pending' | 'failed' | 'disputed'
  amount: number
  userId: string
}): Promise<string> {
  const id = generateId('pt')
  await database.$client.query(
    `INSERT INTO "PaymentTransaction"
       (id, "organizationId", provider, kind, status, amount, currency, "invoiceInstanceId", "createdByUserId", "updatedAt")
     VALUES ($1, $2, 'manual', 'charge', $3, $4, 'usd', $5, $6, now())`,
    [
      id,
      params.organizationId,
      params.status,
      params.amount,
      params.invoiceInstanceId,
      params.userId,
    ]
  )
  return id
}

async function main() {
  const adminUser = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!adminUser) throw new Error('Dev admin user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — same as MI1/WS1 scripts)
  const adminUserId = adminUser.id

  // Real `User` row with no org membership of its own ("stranger" fixture, same one
  // verify-dispatch-ws1.ts uses) — temporarily added to the dev org as a plain 'USER' member
  // to drive the non-admin delete-rejection checks, then removed in cleanup.
  const memberUserId = 'AOE6LhgqU5DMxA2oJlOC6xnfAGhnFeHM'

  console.log(`Org ${organizationId}, admin ${adminUserId}, member ${memberUserId}`)

  const adminHandler = new UnifiedCrudHandler(organizationId, adminUserId)
  const memberHandler = new UnifiedCrudHandler(organizationId, memberUserId)
  const today = new Date().toISOString().split('T')[0]!

  const createdLineIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdWorkOrderIds: string[] = []
  const createdQuoteIds: string[] = []
  const createdTransactionIds: string[] = []
  const deletedInvoiceIds: string[] = []
  let memberMembershipCreated = false

  try {
    const contactDefId = await entityDefId(organizationId, 'contact')
    const contact = contactDefId
      ? await database.query.EntityInstance.findFirst({
          columns: { id: true },
          where: (t, { eq }) => eq(t.entityDefinitionId, contactDefId),
        })
      : null
    if (!contact) throw new Error('No contact in org — cannot test invoices/work orders')
    const contactRecordId = toRecordId('contact', contact.id)

    // ── Fixture: temporary non-admin membership ─────────────────────────────
    console.log('0: fixture — temporary member-role user')
    const existingMembership = await database.query.OrganizationMember.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.userId, memberUserId), eq(t.organizationId, organizationId)),
    })
    if (existingMembership) {
      if (existingMembership.role !== 'USER') {
        throw new Error(
          `Fixture user ${memberUserId} is already role=${existingMembership.role} in org ` +
            `${organizationId} — pick a different non-admin fixture user`
        )
      }
    } else {
      await database.insert(schema.OrganizationMember).values({
        userId: memberUserId,
        organizationId,
        role: 'USER',
        updatedAt: new Date(),
      })
      memberMembershipCreated = true
    }
    await getOrgCache().invalidateAndRecompute(organizationId, ['members', 'memberRoleMap'])
    check('temporary member-role membership in place', true)

    // ── 1: Paid/disputed invoice rejection (both entry points) ──────────────
    console.log('1: paid/disputed invoice rejection')
    const invPaid = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invPaid.instance.id)
    const invPaidRecordId = toRecordId('invoice', invPaid.instance.id)
    const invPaidLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Paid invoice line',
      line_item_qty: 1,
      line_item_unit_price: 10000,
      line_item_taxable: false,
      line_item_invoice: invPaidRecordId,
    })
    createdLineIds.push(invPaidLine.instance.id)
    const invPaidPayment = await recordManualPayment({
      organizationId,
      userId: adminUserId,
      invoiceInstanceId: invPaid.instance.id,
      amount: 10000,
      date: today,
      method: 'cash',
    })
    createdTransactionIds.push(invPaidPayment.transactionId)

    const paidViaHandlerErr = await expectThrow(() => adminHandler.delete(invPaidRecordId))
    check(
      'paid invoice delete via UnifiedCrudHandler.delete rejected (payments message)',
      paidViaHandlerErr instanceof AuxxError &&
        /Remove recorded payments before deleting this invoice/.test(
          (paidViaHandlerErr as Error).message
        ),
      paidViaHandlerErr
    )

    const paidViaLifecycleErr = await expectThrow(() =>
      deleteInvoice({ organizationId, userId: adminUserId, invoiceInstanceId: invPaid.instance.id })
    )
    check(
      'same paid invoice delete via deleteInvoice() rejected (payments message)',
      paidViaLifecycleErr instanceof AuxxError &&
        /Remove recorded payments before deleting this invoice/.test(
          (paidViaLifecycleErr as Error).message
        ),
      paidViaLifecycleErr
    )

    const invDisputed = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invDisputed.instance.id)
    const invDisputedRecordId = toRecordId('invoice', invDisputed.instance.id)
    const invDisputedLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Disputed invoice line',
      line_item_qty: 1,
      line_item_unit_price: 5000,
      line_item_taxable: false,
      line_item_invoice: invDisputedRecordId,
    })
    createdLineIds.push(invDisputedLine.instance.id)
    const disputedTxId = await insertRawPaymentTransaction({
      organizationId,
      invoiceInstanceId: invDisputed.instance.id,
      status: 'disputed',
      amount: 5000,
      userId: adminUserId,
    })
    createdTransactionIds.push(disputedTxId)

    const disputedErr = await expectThrow(() => adminHandler.delete(invDisputedRecordId))
    check(
      'disputed-charge invoice delete rejected (payments message)',
      disputedErr instanceof AuxxError &&
        /Remove recorded payments before deleting this invoice/.test(
          (disputedErr as Error).message
        ),
      disputedErr
    )

    check(
      'paid/disputed invoices + lines + ledger rows untouched after rejections',
      (await instanceExists(invPaid.instance.id)) &&
        (await instanceExists(invPaidLine.instance.id)) &&
        (await instanceExists(invDisputed.instance.id)) &&
        (await instanceExists(invDisputedLine.instance.id)) &&
        (await countPaymentTransactions(invPaid.instance.id)) === 1 &&
        (await countPaymentTransactions(invDisputed.instance.id)) === 1
    )

    // ── 2: Non-admin rejection (invoice + work order) ────────────────────────
    console.log('2: non-admin rejection')
    const invMember = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invMember.instance.id)
    const invMemberRecordId = toRecordId('invoice', invMember.instance.id)
    const invMemberLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Non-admin-blocked invoice line',
      line_item_qty: 1,
      line_item_unit_price: 2500,
      line_item_taxable: false,
      line_item_invoice: invMemberRecordId,
    })
    createdLineIds.push(invMemberLine.instance.id)

    const memberInvoiceErr = await expectThrow(() => memberHandler.delete(invMemberRecordId))
    check(
      'non-admin invoice delete rejected (Only admins can delete invoices)',
      memberInvoiceErr instanceof AuxxError &&
        /Only admins can delete invoices/.test((memberInvoiceErr as Error).message),
      memberInvoiceErr
    )
    check(
      'invoice + line survive the non-admin rejection',
      (await instanceExists(invMember.instance.id)) &&
        (await instanceExists(invMemberLine.instance.id))
    )

    const woMember = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] Non-admin-blocked WO',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woMember.instance.id)
    const woMemberRecordId = toRecordId('work_order', woMember.instance.id)

    const memberWoErr = await expectThrow(() => memberHandler.delete(woMemberRecordId))
    check(
      'non-admin work-order delete rejected (Only admins can delete jobs)',
      memberWoErr instanceof AuxxError &&
        /Only admins can delete jobs/.test((memberWoErr as Error).message),
      memberWoErr
    )
    check('work order survives the non-admin rejection', await instanceExists(woMember.instance.id))

    // ── 3: Pending/failed ledger residue deletes cleanly ─────────────────────
    console.log('3: pending/failed ledger residue')
    const invPending = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invPending.instance.id)
    const invPendingRecordId = toRecordId('invoice', invPending.instance.id)
    const invPendingLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Pending-residue invoice line',
      line_item_qty: 1,
      line_item_unit_price: 3000,
      line_item_taxable: false,
      line_item_invoice: invPendingRecordId,
    })
    createdLineIds.push(invPendingLine.instance.id)
    const pendingTxId = await insertRawPaymentTransaction({
      organizationId,
      invoiceInstanceId: invPending.instance.id,
      status: 'pending',
      amount: 3000,
      userId: adminUserId,
    })
    createdTransactionIds.push(pendingTxId)

    const pendingDeleteErr = await expectThrow(() => adminHandler.delete(invPendingRecordId))
    check(
      'pending-residue invoice deletes without throwing',
      pendingDeleteErr === undefined,
      pendingDeleteErr
    )
    deletedInvoiceIds.push(invPending.instance.id)
    check(
      'pending-residue ledger row purged + invoice instance gone',
      (await countPaymentTransactions(invPending.instance.id)) === 0 &&
        !(await instanceExists(invPending.instance.id))
    )

    const invFailed = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invFailed.instance.id)
    const invFailedRecordId = toRecordId('invoice', invFailed.instance.id)
    const invFailedLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Failed-residue invoice line',
      line_item_qty: 1,
      line_item_unit_price: 2000,
      line_item_taxable: false,
      line_item_invoice: invFailedRecordId,
    })
    createdLineIds.push(invFailedLine.instance.id)
    const failedTxId = await insertRawPaymentTransaction({
      organizationId,
      invoiceInstanceId: invFailed.instance.id,
      status: 'failed',
      amount: 2000,
      userId: adminUserId,
    })
    createdTransactionIds.push(failedTxId)

    const failedDeleteErr = await expectThrow(() => adminHandler.delete(invFailedRecordId))
    check(
      'failed-residue invoice deletes without throwing',
      failedDeleteErr === undefined,
      failedDeleteErr
    )
    deletedInvoiceIds.push(invFailed.instance.id)
    check(
      'failed-residue ledger row purged + invoice instance gone',
      (await countPaymentTransactions(invFailed.instance.id)) === 0 &&
        !(await instanceExists(invFailed.instance.id))
    )

    // ── 4: Unpaid invoice delete unstamps sources + deletes own lines ────────
    console.log('4: unpaid invoice delete — unstamp + own-line cleanup')
    const woSource = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] WO with a source line',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woSource.instance.id)
    const sourceLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] WO source line (to be unstamped, not deleted)',
      line_item_qty: 1,
      line_item_unit_price: 4000,
      line_item_taxable: false,
      line_item_work_order: toRecordId('work_order', woSource.instance.id),
    })
    createdLineIds.push(sourceLine.instance.id)

    const invUnstamp = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invUnstamp.instance.id)
    const invUnstampRecordId = toRecordId('invoice', invUnstamp.instance.id)

    const ownCopy = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Invoice-owned line copy',
      line_item_qty: 1,
      line_item_unit_price: 4000,
      line_item_taxable: false,
      line_item_invoice: invUnstampRecordId,
    })
    createdLineIds.push(ownCopy.instance.id)
    // Allocation-model link (plan 24): sources are never field-stamped anymore — the claim
    // lives in an active InvoiceLineAllocation row bridging source → invoice copy.
    await database.insert(schema.InvoiceLineAllocation).values({
      organizationId,
      workOrderId: woSource.instance.id,
      invoiceId: invUnstamp.instance.id,
      invoiceLineItemId: ownCopy.instance.id,
      sourceLineItemId: sourceLine.instance.id,
      kind: 'contract',
      amount: 4000,
      status: 'active',
    })

    const unstampDeleteErr = await expectThrow(() => adminHandler.delete(invUnstampRecordId))
    check(
      'unpaid invoice with a source line + own copy deletes without throwing',
      unstampDeleteErr === undefined,
      unstampDeleteErr
    )
    deletedInvoiceIds.push(invUnstamp.instance.id)

    const sourceAllocationsAfter = await database.query.InvoiceLineAllocation.findMany({
      columns: { id: true, status: true },
      where: (t, { eq }) => eq(t.sourceLineItemId, sourceLine.instance.id),
    })
    const sourceWorkOrderAfter = await fieldValueByAttr(
      organizationId,
      'line_item',
      sourceLine.instance.id,
      'line_item_work_order'
    )
    check(
      'source line freed (allocation rows gone with the invoice) but its work order link is untouched',
      sourceAllocationsAfter.length === 0 &&
        sourceWorkOrderAfter?.relatedEntityId === woSource.instance.id,
      {
        allocations: sourceAllocationsAfter,
        workOrder: sourceWorkOrderAfter?.relatedEntityId,
      }
    )
    check('invoice-owned line copy hard-deleted', !(await instanceExists(ownCopy.instance.id)))
    createdLineIds.splice(createdLineIds.indexOf(ownCopy.instance.id), 1)

    // ── 5: MI2 note — per-visit auto-invoice delete frees the line for regather ──
    console.log('5: MI2 — per-visit line unstamped, re-gatherable')
    const woVisit = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] WO for per-visit unstamp',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woVisit.instance.id)
    const visitSourceLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Per-visit source line',
      line_item_qty: 1,
      line_item_unit_price: 1500,
      line_item_taxable: false,
      line_item_visit_id: 'mds-verify-visit-1',
      line_item_work_order: toRecordId('work_order', woVisit.instance.id),
    })
    createdLineIds.push(visitSourceLine.instance.id)
    const invVisit = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invVisit.instance.id)
    const invVisitRecordId = toRecordId('invoice', invVisit.instance.id)
    const visitCopyLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Per-visit invoice copy',
      line_item_qty: 1,
      line_item_unit_price: 1500,
      line_item_taxable: false,
      line_item_invoice: invVisitRecordId,
    })
    createdLineIds.push(visitCopyLine.instance.id)
    await database.insert(schema.InvoiceLineAllocation).values({
      organizationId,
      workOrderId: woVisit.instance.id,
      invoiceId: invVisit.instance.id,
      invoiceLineItemId: visitCopyLine.instance.id,
      sourceLineItemId: visitSourceLine.instance.id,
      kind: 'visit_addition',
      amount: 1500,
      status: 'active',
    })

    await adminHandler.delete(invVisitRecordId)
    deletedInvoiceIds.push(invVisit.instance.id)

    const uninvoicedAfterDelete = await listUninvoicedLines({
      organizationId,
      userId: adminUserId,
      workOrderInstanceId: woVisit.instance.id,
    })
    check(
      'per-visit line is uninvoiced again after its auto-invoice-style invoice is deleted (MI2 §E)',
      uninvoicedAfterDelete.some((l) => l.instanceId === visitSourceLine.instance.id),
      uninvoicedAfterDelete.map((l) => l.instanceId)
    )

    // ── 6: Bulk-style mixed batch (one paid + one unpaid) ────────────────────
    console.log('6: bulk mixed batch')
    const invBulkPaid = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invBulkPaid.instance.id)
    const invBulkPaidRecordId = toRecordId('invoice', invBulkPaid.instance.id)
    const invBulkPaidLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Bulk-batch paid line',
      line_item_qty: 1,
      line_item_unit_price: 8000,
      line_item_taxable: false,
      line_item_invoice: invBulkPaidRecordId,
    })
    createdLineIds.push(invBulkPaidLine.instance.id)
    const bulkPayment = await recordManualPayment({
      organizationId,
      userId: adminUserId,
      invoiceInstanceId: invBulkPaid.instance.id,
      amount: 8000,
      date: today,
      method: 'card',
    })
    createdTransactionIds.push(bulkPayment.transactionId)

    const invBulkUnpaid = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invBulkUnpaid.instance.id)
    const invBulkUnpaidRecordId = toRecordId('invoice', invBulkUnpaid.instance.id)
    const invBulkUnpaidLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Bulk-batch unpaid line',
      line_item_qty: 1,
      line_item_unit_price: 1200,
      line_item_taxable: false,
      line_item_invoice: invBulkUnpaidRecordId,
    })
    createdLineIds.push(invBulkUnpaidLine.instance.id)

    const bulkResult = await adminHandler.bulkDelete([invBulkPaidRecordId, invBulkUnpaidRecordId])
    check(
      'bulk delete: 1 succeeded, 1 failed',
      bulkResult.count === 1 && bulkResult.errors.length === 1,
      bulkResult
    )
    check(
      'bulk delete: the failure is the paid invoice, with the payments message',
      bulkResult.errors[0]?.recordId === invBulkPaidRecordId &&
        /Remove recorded payments before deleting this invoice/.test(
          bulkResult.errors[0]?.message ?? ''
        ),
      bulkResult.errors[0]
    )
    check(
      'bulk delete: paid invoice survives, unpaid invoice is gone',
      (await instanceExists(invBulkPaid.instance.id)) &&
        !(await instanceExists(invBulkUnpaid.instance.id))
    )
    if (!(await instanceExists(invBulkUnpaid.instance.id)))
      deletedInvoiceIds.push(invBulkUnpaid.instance.id)

    // ── 7: Work-order-with-invoice rejected (direct rel + stamped line) ──────
    console.log('7: work order with a linked invoice rejected')
    const woWithRel = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] WO with a direct invoice rel',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woWithRel.instance.id)
    const woWithRelRecordId = toRecordId('work_order', woWithRel.instance.id)
    const invForRel = await adminHandler.create('invoice', {
      invoice_contact: contactRecordId,
      invoice_work_order: woWithRelRecordId,
    })
    createdInvoiceIds.push(invForRel.instance.id)

    const woRelErr = await expectThrow(() => adminHandler.delete(woWithRelRecordId))
    check(
      'work order with a direct invoice_work_order link rejected (delete/void invoices first)',
      woRelErr instanceof AuxxError && /invoices first/i.test((woRelErr as Error).message),
      woRelErr
    )

    const woWithLine = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] WO with a stamped-line-only invoice',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woWithLine.instance.id)
    const woWithLineRecordId = toRecordId('work_order', woWithLine.instance.id)
    const lineForWoLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Stamped line for WO-invoice guard',
      line_item_qty: 1,
      line_item_unit_price: 900,
      line_item_taxable: false,
      line_item_work_order: woWithLineRecordId,
    })
    createdLineIds.push(lineForWoLine.instance.id)
    const invForLine = await adminHandler.create('invoice', { invoice_contact: contactRecordId })
    createdInvoiceIds.push(invForLine.instance.id)
    const copyForWoLine = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] Invoice copy for WO-allocation guard',
      line_item_qty: 1,
      line_item_unit_price: 900,
      line_item_taxable: false,
      line_item_invoice: toRecordId('invoice', invForLine.instance.id),
    })
    createdLineIds.push(copyForWoLine.instance.id)
    // The WO↔invoice link that must block the delete is now an allocation row, not a stamp.
    await database.insert(schema.InvoiceLineAllocation).values({
      organizationId,
      workOrderId: woWithLine.instance.id,
      invoiceId: invForLine.instance.id,
      invoiceLineItemId: copyForWoLine.instance.id,
      sourceLineItemId: lineForWoLine.instance.id,
      kind: 'contract',
      amount: 900,
      status: 'active',
    })

    const woLineErr = await expectThrow(() => adminHandler.delete(woWithLineRecordId))
    check(
      'work order linked only via an allocation row rejected (delete/void invoices first)',
      woLineErr instanceof AuxxError && /invoices first/i.test((woLineErr as Error).message),
      woLineErr
    )
    check(
      'both invoice-linked work orders survive their rejections',
      (await instanceExists(woWithRel.instance.id)) &&
        (await instanceExists(woWithLine.instance.id))
    )

    // ── 8: Work-order-without-invoice deletes + line cleanup + visit cascade ─
    console.log('8: work order without an invoice deletes cleanly')
    const woClean = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] WO with no invoices (deletable)',
      work_order_contact: contactRecordId,
    })
    createdWorkOrderIds.push(woClean.instance.id)
    const woCleanRecordId = toRecordId('work_order', woClean.instance.id)
    const lineClean = await adminHandler.create('line_item', {
      line_item_name: '[MDS-verify] WO-owned line (should be cleaned up)',
      line_item_qty: 1,
      line_item_unit_price: 600,
      line_item_taxable: false,
      line_item_work_order: woCleanRecordId,
    })
    createdLineIds.push(lineClean.instance.id)

    const visitCountBefore = await countVisits(woClean.instance.id)
    check(
      'work order auto-created exactly one visit on create (ensureVisitOnWorkOrderCreate)',
      visitCountBefore === 1,
      visitCountBefore
    )

    const cleanDeleteErr = await expectThrow(() => adminHandler.delete(woCleanRecordId))
    check(
      'work order without invoices deletes without throwing',
      cleanDeleteErr === undefined,
      cleanDeleteErr
    )
    createdWorkOrderIds.splice(createdWorkOrderIds.indexOf(woClean.instance.id), 1)
    check('WO-owned line item cleaned up', !(await instanceExists(lineClean.instance.id)))
    createdLineIds.splice(createdLineIds.indexOf(lineClean.instance.id), 1)
    check(
      'WorkOrderVisit rows cascade away with the work order',
      (await countVisits(woClean.instance.id)) === 0
    )

    // ── 9: Quote converted-guard ──────────────────────────────────────────────
    console.log('9: quote converted-guard')
    const quoteConv = await adminHandler.create('quote', {
      quote_title: '[MDS-verify] Converted quote',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(quoteConv.instance.id)
    const quoteConvRecordId = toRecordId('quote', quoteConv.instance.id)
    const woConv = await adminHandler.create('work_order', {
      work_order_title: '[MDS-verify] Job converted from quoteConv',
      work_order_contact: contactRecordId,
      work_order_quote: quoteConvRecordId,
    })
    createdWorkOrderIds.push(woConv.instance.id)

    const convertedQuoteErr = await expectThrow(() => adminHandler.delete(quoteConvRecordId))
    check(
      'quote with a linked non-canceled job rejected (cancel or delete the job first)',
      convertedQuoteErr instanceof AuxxError &&
        /cancel or delete the job first/i.test((convertedQuoteErr as Error).message),
      convertedQuoteErr
    )

    await adminHandler.update(toRecordId('work_order', woConv.instance.id), {
      work_order_status: 'canceled',
    })
    const convertedQuoteDeleteErr = await expectThrow(() => adminHandler.delete(quoteConvRecordId))
    check(
      'same quote deletes once its only job is canceled',
      convertedQuoteDeleteErr === undefined,
      convertedQuoteDeleteErr
    )
    createdQuoteIds.splice(createdQuoteIds.indexOf(quoteConv.instance.id), 1)

    const quoteNoJob = await adminHandler.create('quote', {
      quote_title: '[MDS-verify] Quote with no job',
      quote_contact: contactRecordId,
    })
    createdQuoteIds.push(quoteNoJob.instance.id)
    const noJobDeleteErr = await expectThrow(() =>
      adminHandler.delete(toRecordId('quote', quoteNoJob.instance.id))
    )
    check(
      'quote with no linked job deletes without throwing',
      noJobDeleteErr === undefined,
      noJobDeleteErr
    )
    createdQuoteIds.splice(createdQuoteIds.indexOf(quoteNoJob.instance.id), 1)

    // ── 10: Dangling relatedEntityId sweep for hook-owned stamps ──────────────
    console.log('10: dangling relatedEntityId sweep')
    const lineItemInvoiceFieldId = await fieldId(organizationId, 'line_item', 'line_item_invoice')
    if (!lineItemInvoiceFieldId) throw new Error('line_item_invoice field not found')
    const dangling = await database.query.FieldValue.findMany({
      columns: { id: true, entityId: true, relatedEntityId: true },
      where: (t, { and, eq, inArray }) =>
        and(eq(t.fieldId, lineItemInvoiceFieldId), inArray(t.relatedEntityId, deletedInvoiceIds)),
    })
    check(
      'no dangling line_item_invoice stamps point at any invoice deleted during this run',
      dangling.length === 0,
      dangling
    )
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────
    console.log(
      `Cleanup: ${createdTransactionIds.length} ledger rows, ${createdLineIds.length} lines, ` +
        `${createdInvoiceIds.length} invoices, ${createdWorkOrderIds.length} work orders, ` +
        `${createdQuoteIds.length} quotes`
    )
    for (const transactionId of [...new Set(createdTransactionIds)]) {
      try {
        // Mirror pointer lives on `PaymentAllocation.paymentInstanceId` now (money
        // 16-deposit-accounting.md §C.6 moved it off `PaymentTransaction`).
        const allocations = await database.query.PaymentAllocation.findMany({
          where: (t, { eq }) => eq(t.paymentTransactionId, transactionId),
        })
        for (const allocation of allocations) {
          if (!allocation.paymentInstanceId) continue
          try {
            await adminHandler.delete(toRecordId('payment', allocation.paymentInstanceId))
          } catch {
            // best-effort — the row delete below is the important part
          }
        }
        await database.$client.query('DELETE FROM "PaymentTransaction" WHERE id = $1', [
          transactionId,
        ])
      } catch (err) {
        console.log(
          `  cleanup failed for PaymentTransaction:${transactionId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    // Invoices BEFORE lines: `InvoiceLineAllocation.sourceLineItemId` is a RESTRICT FK, so a
    // once-allocated source line only becomes hard-deletable after its invoice's cascade
    // removes the allocation rows.
    for (const id of [...new Set(createdInvoiceIds)]) {
      try {
        await adminHandler.delete(toRecordId('invoice', id))
      } catch (err) {
        console.log(`  cleanup failed for invoice:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    for (const id of [...new Set(createdLineIds)]) {
      try {
        await adminHandler.delete(toRecordId('line_item', id))
      } catch (err) {
        console.log(
          `  cleanup failed for line_item:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdWorkOrderIds)]) {
      try {
        await adminHandler.delete(toRecordId('work_order', id))
      } catch (err) {
        console.log(
          `  cleanup failed for work_order:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdQuoteIds)]) {
      try {
        await adminHandler.delete(toRecordId('quote', id))
      } catch (err) {
        console.log(`  cleanup failed for quote:${id}:`, err instanceof Error ? err.message : err)
      }
    }
    if (memberMembershipCreated) {
      try {
        await database.$client.query(
          'DELETE FROM "OrganizationMember" WHERE "userId" = $1 AND "organizationId" = $2',
          [memberUserId, organizationId]
        )
        await getOrgCache().invalidateAndRecompute(organizationId, ['members', 'memberRoleMap'])
      } catch (err) {
        console.log(
          '  cleanup failed removing temporary member-role membership:',
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

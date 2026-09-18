// packages/lib/src/accounting/money/customer-money/order-evidence-reconciler.ts

/**
 * Order payment evidence as a dirty-parent reconciler
 * (`plans/events/08-derived-parent-reconciler-plan.md`; LIB-LAYOUT §3f).
 *
 * Marking means one assessment per order per write, after commit, however many
 * per-field rules fired for it.
 *
 * ## One key, three kinds of marked record
 *
 * An order can be marked directly (its own `created` / evidence rules) or through
 * a child (`line_item`, `customer_transaction`). Two keys would be the obvious
 * shape, but then an order and its own lines dirtied by one write drain twice.
 * So the marked id carries its kind — `order:<id>`, `line_item:<id>`,
 * `customer_transaction:<id>` — and `resolve` maps all three onto order instance
 * ids in at most two queries. One key, one dedupe pool, one rebuild.
 */

import { type Database, database } from '@auxx/database'
import {
  defineParentReconciler,
  resolveParentsByRelation,
} from '../../../reconcilers/parent-reconciler'
import { bridgeFinancialRecords } from './bridge'
import { reconcileOrderPaymentEvidence } from './record-evidence'

export const ORDER_PAYMENT_EVIDENCE = 'money.order-payment-evidence'

/** What a marked record is, relative to the order whose evidence gets rebuilt. */
export type OrderEvidenceKind = 'order' | 'line_item' | 'customer_transaction'

const CHILD_RELATIONS = {
  line_item: 'line_item_order',
  customer_transaction: 'customer_transaction_order',
} as const

/** Split the tagged ids back into their kinds, then resolve the children's orders. */
async function resolveOrders(organizationId: string, markedIds: string[]): Promise<string[]> {
  const byKind = new Map<OrderEvidenceKind, string[]>()
  for (const marked of markedIds) {
    const separator = marked.indexOf(':')
    if (separator < 0) continue
    const kind = marked.slice(0, separator) as OrderEvidenceKind
    const instanceId = marked.slice(separator + 1)
    if (!instanceId) continue
    const ids = byKind.get(kind) ?? []
    ids.push(instanceId)
    byKind.set(kind, ids)
  }

  const orderIds = [...(byKind.get('order') ?? [])]
  for (const [kind, systemAttribute] of Object.entries(CHILD_RELATIONS)) {
    const children = byKind.get(kind as OrderEvidenceKind)
    if (!children?.length) continue
    orderIds.push(...(await resolveParentsByRelation(organizationId, systemAttribute, children)))
  }
  return orderIds
}

const reconciler = defineParentReconciler<string>({
  key: ORDER_PAYMENT_EVIDENCE,
  resolve: resolveOrders,
  // Batched, not per parent: the assessment already chunks its orders 100 at a
  // time and refreshes coverage per chunk, so a per-parent callback would undo it.
  rebuildBatch: (organizationId, userId, orderInstanceIds) =>
    rebuildOrders(database, organizationId, orderInstanceIds, userId ?? ''),
})

async function rebuildOrders(
  db: Database,
  organizationId: string,
  orderInstanceIds: string[],
  userId = ''
): Promise<void> {
  if (!orderInstanceIds.length) return
  // The bridge stages acceptances from the records and reconciles them itself;
  // the second pass catches orders whose evidence was already staged.
  await bridgeFinancialRecords(db, {
    organizationId,
    actorUserId: userId,
    records: orderInstanceIds.map((id) => ({ id, kind: 'order' as const })),
  })
  await reconcileOrderPaymentEvidence(db, { organizationId, orderInstanceIds })
}

/** Register the drain. Idempotent per key. */
export function registerOrderEvidenceReconciler(): void {
  reconciler.register()
}

/**
 * Assess a whole batch NOW, with no dirty-parent buffer in play — the sync-finalize
 * seam (plan 08 §6.6). Takes the tagged ids deliberately: the caller has the whole
 * manifest, and marking them one at a time would assess once per record, since
 * nothing drains at finalize.
 */
export async function reconcileOrderEvidenceFromSync(
  db: Database,
  organizationId: string,
  markedIds: string[]
): Promise<void> {
  const orderInstanceIds = [...new Set(await resolveOrders(organizationId, markedIds))]
  await rebuildOrders(db, organizationId, orderInstanceIds)
}

/**
 * Mark one record for its order's evidence assessment, or assess now when nothing
 * will drain (see `ParentReconciler.mark` for why that fallback is load-bearing).
 */
export async function markOrderEvidence(
  organizationId: string,
  userId: string,
  kind: OrderEvidenceKind,
  entityInstanceId: string
): Promise<void> {
  if (!entityInstanceId) return
  await reconciler.mark(organizationId, userId, `${kind}:${entityInstanceId}`)
}

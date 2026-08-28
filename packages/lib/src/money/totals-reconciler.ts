// packages/lib/src/money/totals-reconciler.ts

/**
 * The totals engine as a dirty-parent reconciler (plan 08 phase 2).
 *
 * Before this, `recomputeOnLineChange` recomputed the whole document inline, and
 * the hook chain is dispatched per `(record, field)` — so pasting 20 lines fired
 * it 40 times and rebuilt the same quote 40 times. Now each fire marks, and the
 * drain rebuilds it once.
 *
 * Six keys, not one, because the drain needs to know what it was handed:
 *
 * | key | marked with | drain |
 * | --- | --- | --- |
 * | `money-totals:line_item` | a LINE instance id | batch-resolve parents, then recompute |
 * | `money-totals:purchase_order_line` | a PO LINE instance id | same, single-parent ladder |
 * | `money-totals:quote` / `:invoice` / `:order` / `:purchase_order` | a DOCUMENT instance id | recompute directly |
 *
 * A write that dirties both a line and its document recomputes twice. That is
 * accepted rather than merged: it is rare (a header field and a line body in one
 * operation), and #1953's compare-before-write makes the second pass write
 * nothing.
 *
 * This is the one consumer whose parent is NOT a bare instance id — it is
 * `(documentType, instanceId)` — which is why `dedupeKey` exists on the shared
 * spec at all, and why the quote -> invoice-without-work-order -> order ladder
 * below stayed here rather than moving into `resolveParentsByRelation`.
 */

import { getOrgCache } from '../cache'
import { readFieldRelations } from '../field-values/read-field-scalars'
import { defineParentReconciler, resolveParentsByRelation } from '../reconcilers/parent-reconciler'
import type { TotalledDocumentType } from './totals-hooks'

/** Key per marked entity. See the table above. */
export const MONEY_TOTALS_LINE_ITEM = 'money-totals:line_item'
export const MONEY_TOTALS_PURCHASE_ORDER_LINE = 'money-totals:purchase_order_line'
export const moneyTotalsDocumentKey = (documentType: TotalledDocumentType): string =>
  `money-totals:${documentType}`

const DOCUMENT_TYPES: TotalledDocumentType[] = ['quote', 'invoice', 'order', 'purchase_order']

/** A resolved parent, deduped by both halves. */
interface ParentDocument {
  documentType: TotalledDocumentType
  documentInstanceId: string
}

/** Two documents are the same document only when BOTH halves match. */
const documentDedupeKey = (parent: ParentDocument): string =>
  `${parent.documentType}:${parent.documentInstanceId}`

/**
 * Recompute one document.
 *
 * `recomputeTotals` is lazy-imported so this module carries no RUNTIME edge back
 * to `totals-hooks` — which imports this one. The type import above is erased, so
 * the cycle is type-only, the same dodge `builds/auto-build-rule.ts` uses for its
 * orchestrators.
 */
async function recomputeOne(
  organizationId: string,
  userId: string,
  parent: ParentDocument
): Promise<void> {
  const { recomputeTotals } = await import('./totals-hooks')
  await recomputeTotals({
    organizationId,
    userId,
    documentType: parent.documentType,
    documentInstanceId: parent.documentInstanceId,
  })
}

const lineReconciler = defineParentReconciler<ParentDocument>({
  key: MONEY_TOTALS_LINE_ITEM,
  resolve: resolveLineParents,
  dedupeKey: documentDedupeKey,
  rebuild: recomputeOne,
})

const purchaseOrderLineReconciler = defineParentReconciler<ParentDocument>({
  key: MONEY_TOTALS_PURCHASE_ORDER_LINE,
  resolve: resolvePurchaseOrderLineParents,
  dedupeKey: documentDedupeKey,
  rebuild: recomputeOne,
})

/**
 * One self-reconciler per document type. The marked record IS the parent here, so
 * there is no `resolve` — the document type comes from the closure rather than
 * from a lookup, which is what keeps the four keys distinguishable in the buffer.
 */
const documentReconcilers = new Map(
  DOCUMENT_TYPES.map((documentType) => [
    documentType,
    defineParentReconciler<string>({
      key: moneyTotalsDocumentKey(documentType),
      rebuild: (organizationId, userId, documentInstanceId) =>
        recomputeOne(organizationId, userId, { documentType, documentInstanceId }),
    }),
  ])
)

/**
 * Register the six drains. Called from `registerAllHooks()`, idempotent per key
 * the same way `registerAutoBuildRules()` is.
 */
export function registerMoneyTotalsReconcilers(): void {
  lineReconciler.register()
  purchaseOrderLineReconciler.register()
  for (const reconciler of documentReconcilers.values()) reconciler.register()
}

/**
 * Resolve every line's parent document in ONE query, applying the same
 * precedence ladder `resolveLineParentDocument` applies per line: quote first,
 * then invoice but ONLY when the line carries no work order (§B.3/§G.1 — a WO
 * source line stamped with `line_item_invoice` must never recompute the
 * invoice), then order.
 *
 * 🛑 The one parent resolution that did NOT move to `resolveParentsByRelation`,
 * because it is the only one that reads several relations and ranks them. Reading
 * `relatedEntityId` directly is what makes the batch possible; the per-line
 * version issued up to three `getFieldValues` calls to walk the same ladder, so
 * 20 lines cost up to 60 round trips before this.
 */
async function resolveLineParents(
  organizationId: string,
  lineInstanceIds: string[]
): Promise<ParentDocument[]> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'line_item_quote',
      'line_item_invoice',
      'line_item_order',
      'line_item_work_order',
    ] as const)

  const byField = new Map<string, 'quote' | 'invoice' | 'order' | 'work_order'>()
  if (cf.line_item_quote) byField.set(cf.line_item_quote.id, 'quote')
  if (cf.line_item_invoice) byField.set(cf.line_item_invoice.id, 'invoice')
  if (cf.line_item_order) byField.set(cf.line_item_order.id, 'order')
  if (cf.line_item_work_order) byField.set(cf.line_item_work_order.id, 'work_order')
  if (byField.size === 0) return []

  const rels = await readFieldRelations(undefined, organizationId, lineInstanceIds, [
    ...byField.keys(),
  ])

  const parents: ParentDocument[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const row = rels.get(lineInstanceId)
    if (!row) continue

    const slot = (which: 'quote' | 'invoice' | 'order' | 'work_order'): string | undefined => {
      for (const [fieldId, role] of byField) if (role === which) return row.get(fieldId)
      return undefined
    }

    const quote = slot('quote')
    if (quote) {
      parents.push({ documentType: 'quote', documentInstanceId: quote })
      continue
    }
    // Only when BOTH fields exist, matching the per-line ladder's own guard: an
    // org without `line_item_work_order` cannot prove the line is not a WO copy.
    const invoice = cf.line_item_invoice && cf.line_item_work_order ? slot('invoice') : undefined
    if (invoice && !slot('work_order')) {
      parents.push({ documentType: 'invoice', documentInstanceId: invoice })
      continue
    }
    const order = slot('order')
    if (order) parents.push({ documentType: 'order', documentInstanceId: order })
  }
  return parents
}

/** A `purchase_order_line` has exactly one possible parent — no ladder. */
async function resolvePurchaseOrderLineParents(
  organizationId: string,
  lineInstanceIds: string[]
): Promise<ParentDocument[]> {
  const purchaseOrderIds = await resolveParentsByRelation(
    organizationId,
    'purchase_order_line_purchase_order',
    lineInstanceIds
  )
  return purchaseOrderIds.map((documentInstanceId) => ({
    documentType: 'purchase_order' as const,
    documentInstanceId,
  }))
}

/**
 * Mark a document for recompute, or recompute it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see `ParentReconciler.mark`: a caller that
 * reached the hook chain through an exported `field-value-mutations` function
 * rather than a public service method has no scope, and without this its totals
 * would silently stop updating.
 */
export async function markOrRecomputeDocument(
  organizationId: string,
  userId: string,
  documentType: TotalledDocumentType,
  documentInstanceId: string
): Promise<void> {
  await documentReconcilers.get(documentType)?.mark(organizationId, userId, documentInstanceId)
}

/** {@link markOrRecomputeDocument}'s line-side twin. */
export async function markOrRecomputeLine(
  organizationId: string,
  userId: string,
  key: typeof MONEY_TOTALS_LINE_ITEM | typeof MONEY_TOTALS_PURCHASE_ORDER_LINE,
  lineInstanceId: string
): Promise<void> {
  const reconciler = key === MONEY_TOTALS_LINE_ITEM ? lineReconciler : purchaseOrderLineReconciler
  await reconciler.mark(organizationId, userId, lineInstanceId)
}

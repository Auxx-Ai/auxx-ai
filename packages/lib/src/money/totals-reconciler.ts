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
 */

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { markParentDirty, registerReconciler } from '../reconcilers/dirty-parents'
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

let registered = false

/**
 * Register the six drains. Called from `registerAllHooks()`, idempotent under a
 * repeated bootstrap the same way `registerAutoBuildRules()` is.
 */
export function registerMoneyTotalsReconcilers(): void {
  if (registered) return
  registered = true

  registerReconciler(
    MONEY_TOTALS_LINE_ITEM,
    async ({ organizationId, userId, parentInstanceIds }) => {
      const parents = await resolveLineParents(organizationId, parentInstanceIds)
      await recomputeEach(organizationId, userId, parents)
    }
  )

  registerReconciler(
    MONEY_TOTALS_PURCHASE_ORDER_LINE,
    async ({ organizationId, userId, parentInstanceIds }) => {
      const parents = await resolvePurchaseOrderLineParents(organizationId, parentInstanceIds)
      await recomputeEach(organizationId, userId, parents)
    }
  )

  for (const documentType of DOCUMENT_TYPES) {
    registerReconciler(
      moneyTotalsDocumentKey(documentType),
      async ({ organizationId, userId, parentInstanceIds }) => {
        await recomputeEach(
          organizationId,
          userId,
          parentInstanceIds.map((documentInstanceId) => ({ documentType, documentInstanceId }))
        )
      }
    )
  }
}

/**
 * Recompute each distinct document once, isolating failures.
 *
 * One document failing must not lose the rest of the batch — the same rule the
 * drain applies across keys, applied again within one key, because here a batch
 * is several unrelated user documents rather than one unit of work.
 */
async function recomputeEach(
  organizationId: string,
  userId: string,
  parents: ParentDocument[]
): Promise<void> {
  if (parents.length === 0) return
  // Lazy, so this module carries no RUNTIME edge back to `totals-hooks` — which
  // imports this one. The type import above is erased, so the cycle is
  // type-only, and the same dodge `builds/auto-build-rule.ts` uses for its
  // orchestrators keeps it that way.
  const { recomputeTotals } = await import('./totals-hooks')

  const seen = new Set<string>()
  for (const parent of parents) {
    const dedupeKey = `${parent.documentType}:${parent.documentInstanceId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    await recomputeTotals({
      organizationId,
      userId,
      documentType: parent.documentType,
      documentInstanceId: parent.documentInstanceId,
    })
  }
}

/**
 * Resolve every line's parent document in ONE query, applying the same
 * precedence ladder `resolveLineParentDocument` applies per line: quote first,
 * then invoice but ONLY when the line carries no work order (§B.3/§G.1 — a WO
 * source line stamped with `line_item_invoice` must never recompute the
 * invoice), then order.
 *
 * Reading `relatedEntityId` directly is what makes the batch possible; the
 * per-line version issued up to three `getFieldValues` calls to walk the same
 * ladder, so 20 lines cost up to 60 round trips before this.
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

  const rels = await readRelations(organizationId, lineInstanceIds, [...byField.keys()])

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
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['purchase_order_line_purchase_order'] as const)
  const relField = cf.purchase_order_line_purchase_order
  if (!relField) return []

  const rels = await readRelations(organizationId, lineInstanceIds, [relField.id])

  const parents: ParentDocument[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const purchaseOrder = rels.get(lineInstanceId)?.get(relField.id)
    if (purchaseOrder) {
      parents.push({ documentType: 'purchase_order', documentInstanceId: purchaseOrder })
    }
  }
  return parents
}

/**
 * `lineInstanceId -> fieldId -> relatedEntityId`, one query per 200-id chunk —
 * the same bound `totals-hooks.ts`'s line read and `record-rules/snapshot-fetcher.ts`
 * use.
 */
async function readRelations(
  organizationId: string,
  instanceIds: string[],
  fieldIds: string[]
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>()
  if (instanceIds.length === 0 || fieldIds.length === 0) return out

  const CHUNK = 200
  for (let i = 0; i < instanceIds.length; i += CHUNK) {
    const chunk = instanceIds.slice(i, i + CHUNK)
    const rows = await database
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.entityId, chunk),
          inArray(schema.FieldValue.fieldId, fieldIds)
        )
      )

    for (const row of rows) {
      if (!row.relatedEntityId) continue
      let values = out.get(row.entityId)
      if (!values) {
        values = new Map()
        out.set(row.entityId, values)
      }
      values.set(row.fieldId, row.relatedEntityId)
    }
  }
  return out
}

/**
 * Mark a document for recompute, or recompute it now when nothing will drain.
 *
 * The inline fallback is load-bearing — see {@link markParentDirty}: a caller
 * that reached the hook chain through an exported `field-value-mutations`
 * function rather than a public service method has no scope, and without this
 * its totals would silently stop updating.
 */
export async function markOrRecomputeDocument(
  organizationId: string,
  userId: string,
  documentType: TotalledDocumentType,
  documentInstanceId: string
): Promise<void> {
  if (markParentDirty(moneyTotalsDocumentKey(documentType), documentInstanceId)) return
  await recomputeEach(organizationId, userId, [{ documentType, documentInstanceId }])
}

/** {@link markOrRecomputeDocument}'s line-side twin. */
export async function markOrRecomputeLine(
  organizationId: string,
  userId: string,
  key: typeof MONEY_TOTALS_LINE_ITEM | typeof MONEY_TOTALS_PURCHASE_ORDER_LINE,
  lineInstanceId: string
): Promise<void> {
  if (markParentDirty(key, lineInstanceId)) return
  const parents =
    key === MONEY_TOTALS_LINE_ITEM
      ? await resolveLineParents(organizationId, [lineInstanceId])
      : await resolvePurchaseOrderLineParents(organizationId, [lineInstanceId])
  await recomputeEach(organizationId, userId, parents)
}

// packages/lib/src/accounting/processors/affirm/resolver.ts

/**
 * `affirm` entry reference resolver (117 F1): an Affirm balance entry's `sourceOrderId` is the
 * Shopify payment id of the receipt it settles. A charge names that receipt; a refund names the
 * one confirmed child refund of it for the entry's amount. Read-only; a miss or a tie leaves the
 * entry unreferenced, which the matcher writes as `no_reference`.
 */

import type { Database, Transaction } from '@auxx/database'
import { findSystemRecordIdsByValue } from '../../../resources/system-records'
import { bridgeFieldSpecs, pivotRecordFields } from '../../money/customer-money/bridge'
import type {
  EntryReferenceResolver,
  FinancialSourceReference,
  UnreferencedEntry,
} from '../../money/payouts/reference-resolvers'

/** The `FinancialSourceObject.objectType` a storefront transaction is stored under. */
const OBJECT_TYPE = 'order_transaction'

const PAYMENT_ID = 'customer_transaction_payment_id'
const PARENT_TRANSACTION_ID = 'customer_transaction_parent_transaction_id'

type Fields = Record<string, unknown>

const text = (value: unknown): string | null => {
  const s = value == null ? '' : String(value)
  return s.length ? s : null
}

/** The reference a stored `customer_transaction` is filed under, or null if it is incomplete. */
function referenceFor(fields: Fields | undefined): FinancialSourceReference | null {
  if (!fields) return null
  const providerKey = text(fields.customer_transaction_provider_key)
  const externalAccountId = text(fields.customer_transaction_account_id)
  const environment = text(fields.customer_transaction_environment)
  const externalId = text(fields.customer_transaction_external_id)
  if (!providerKey || !externalAccountId || !externalId) return null
  if (environment !== 'live' && environment !== 'test') return null
  return {
    sourceAccount: { providerKey, externalAccountId, environment },
    objectType: OBJECT_TYPE,
    externalId,
    componentKey: '',
  }
}

const confirmedOfKind = (fields: Fields | undefined, kind: string) =>
  text(fields?.customer_transaction_kind) === kind &&
  text(fields?.customer_transaction_status) === 'confirmed'

/** The stored decimal amount in minor units. Affirm settles in USD, so the exponent is 2. */
const amountMinor = (fields: Fields | undefined): number | null => {
  const value = Number(text(fields?.customer_transaction_amount))
  return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null
}

/** The one id left in `ids`, or null when none or several are. */
const only = (ids: readonly string[]): string | null => {
  const unique = [...new Set(ids)]
  return unique.length === 1 ? unique[0]! : null
}

async function resolve(
  db: Database | Transaction,
  organizationId: string,
  entries: readonly UnreferencedEntry[]
): Promise<Map<string, FinancialSourceReference>> {
  const resolved = new Map<string, FinancialSourceReference>()
  const paymentIds = [
    ...new Set(entries.flatMap((e) => (e.sourceOrderId ? [e.sourceOrderId] : []))),
  ]
  if (!paymentIds.length) return resolved

  const { entityDefinitionId, specs } = await bridgeFieldSpecs(
    organizationId,
    'customer_transaction'
  )
  if (!entityDefinitionId) return resolved
  const fieldIdByAttribute = new Map(
    [...specs].map(([fieldId, spec]) => [spec.attribute, fieldId] as const)
  )
  const idOf = (attribute: string) => {
    const fieldId = fieldIdByAttribute.get(attribute)
    return fieldId ? { id: fieldId } : null
  }
  const ctx = {
    defId: entityDefinitionId,
    fields: {
      [PAYMENT_ID]: idOf(PAYMENT_ID),
      [PARENT_TRANSACTION_ID]: idOf(PARENT_TRANSACTION_ID),
    },
  }

  const byPaymentId = await findSystemRecordIdsByValue(db, organizationId, ctx, {
    attribute: PAYMENT_ID,
    text: paymentIds,
  })
  const paymentCandidates = [...new Set([...byPaymentId.values()].flat())]
  if (!paymentCandidates.length) return resolved
  const pivot = await pivotRecordFields(db, organizationId, paymentCandidates, specs)

  const receiptByPaymentId = new Map<string, string>()
  for (const [paymentId, ids] of byPaymentId) {
    const receipt = only(ids.filter((id) => confirmedOfKind(pivot.get(id), 'receipt')))
    if (receipt) receiptByPaymentId.set(paymentId, receipt)
  }

  // A refund entry names the ORIGINAL payment id; its own movement is the receipt's child.
  const wantsChild = entries.some((e) => e.type !== 'charge')
  const receiptExternalIds = [...receiptByPaymentId.values()].flatMap((id) => {
    const externalId = text(pivot.get(id)?.customer_transaction_external_id)
    return externalId ? [externalId] : []
  })
  const byParent =
    wantsChild && receiptExternalIds.length
      ? await findSystemRecordIdsByValue(db, organizationId, ctx, {
          attribute: PARENT_TRANSACTION_ID,
          text: receiptExternalIds,
        })
      : new Map<string, string[]>()
  const childIds = [...new Set([...byParent.values()].flat())].filter((id) => !pivot.has(id))
  if (childIds.length) {
    for (const [id, fields] of await pivotRecordFields(db, organizationId, childIds, specs))
      pivot.set(id, fields)
  }

  for (const entry of entries) {
    const receipt = entry.sourceOrderId ? receiptByPaymentId.get(entry.sourceOrderId) : undefined
    if (!receipt) continue
    if (entry.type === 'charge') {
      const reference = referenceFor(pivot.get(receipt))
      if (reference) resolved.set(entry.id, reference)
      continue
    }
    const parentExternalId = text(pivot.get(receipt)?.customer_transaction_external_id)
    if (!parentExternalId || entry.grossMinor == null) continue
    const wanted = Math.abs(entry.grossMinor)
    const child = only(
      (byParent.get(parentExternalId) ?? []).filter(
        (id) => confirmedOfKind(pivot.get(id), 'refund') && amountMinor(pivot.get(id)) === wanted
      )
    )
    const reference = child ? referenceFor(pivot.get(child)) : null
    if (reference) resolved.set(entry.id, reference)
  }
  return resolved
}

/** Affirm's `order_id` (the Shopify payment id) → the Shopify transaction that holds the receipt. */
export const AFFIRM_ENTRY_REFERENCE_RESOLVER: EntryReferenceResolver = {
  providerKey: 'affirm',
  resolve,
}

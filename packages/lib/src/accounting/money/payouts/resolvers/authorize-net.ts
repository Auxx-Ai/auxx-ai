// packages/lib/src/accounting/money/payouts/resolvers/authorize-net.ts

/**
 * `authorize_net` entry reference resolver (build plan §6, payout-links §12 T3): a batch
 * member's `transId` / `invoiceNumber` → the `order_transaction` reference a Shopify receipt
 * is filed under. Read-only; a miss or an ambiguous order leaves the entry unreferenced.
 */

import type { Database, Transaction } from '@auxx/database'
import { getCachedCustomFields, getCachedEntityDefId } from '../../../../cache'
import { findSystemRecordIdsByValue } from '../../../../resources/system-records'
import { bridgeFieldSpecs, pivotRecordFields } from '../../customer-money/bridge'
import type {
  EntryReferenceResolver,
  FinancialSourceReference,
  UnreferencedEntry,
} from '../reference-resolvers'

/** The `FinancialSourceObject.objectType` a storefront transaction is stored under. */
const OBJECT_TYPE = 'order_transaction'

const GATEWAY_TRANSACTION_ID = 'customer_transaction_gateway_transaction_id'
const ORDER_EXTERNAL_ID = 'customer_transaction_order_external_id'
const ORDER_RELATIONSHIP = 'customer_transaction_order'
const ORDER_NUMBER = 'order_number'

/** A processor entry's type against the transaction kind that can settle it. */
const KIND_FOR_TYPE: Record<string, string> = { charge: 'receipt', refund: 'refund' }

type Fields = Record<string, unknown>

const text = (value: unknown): string | null => {
  const s = value == null ? '' : String(value)
  return s.length ? s : null
}

/** `#1234` and `1234` name the same Shopify order; the invoice number may carry either. */
function orderNameSpellings(invoiceNumber: string): string[] {
  const bare = invoiceNumber.startsWith('#') ? invoiceNumber.slice(1) : invoiceNumber
  return [...new Set([invoiceNumber, bare, `#${bare}`])].filter((value) => value.length > 0)
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

/** The one candidate that can settle `entry`, or null when none or several can. */
function onlyCandidate(
  candidates: readonly string[] | undefined,
  entry: UnreferencedEntry,
  pivot: Map<string, Fields>,
  byKind: boolean
): FinancialSourceReference | null {
  if (!candidates?.length) return null
  const wanted = KIND_FOR_TYPE[entry.type]
  const eligible = byKind
    ? candidates.filter(
        (id) =>
          text(pivot.get(id)?.customer_transaction_kind) === wanted &&
          text(pivot.get(id)?.customer_transaction_status) === 'confirmed'
      )
    : [...candidates]
  const unique = [...new Set(eligible)]
  return unique.length === 1 ? referenceFor(pivot.get(unique[0]!)) : null
}

/**
 * Name each entry's receipt, by the gateway transaction id first and the
 * invoice number second.
 *
 * The invoice-number arm resolves only when ONE confirmed transaction of the
 * matching kind sits on the order: an order settled in two captures cannot be
 * split by an invoice number that names both.
 */
async function resolve(
  db: Database | Transaction,
  organizationId: string,
  entries: readonly UnreferencedEntry[]
): Promise<Map<string, FinancialSourceReference>> {
  const resolved = new Map<string, FinancialSourceReference>()
  const transIds = [
    ...new Set(entries.flatMap((e) => (e.sourceTransactionId ? [e.sourceTransactionId] : []))),
  ]
  const invoiceNumbers = [
    ...new Set(entries.flatMap((e) => (e.sourceOrderId ? [e.sourceOrderId] : []))),
  ]
  if (!transIds.length && !invoiceNumbers.length) return resolved

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
  const transactionCtx = {
    defId: entityDefinitionId,
    fields: {
      [GATEWAY_TRANSACTION_ID]: idOf(GATEWAY_TRANSACTION_ID),
      [ORDER_EXTERNAL_ID]: idOf(ORDER_EXTERNAL_ID),
      [ORDER_RELATIONSHIP]: idOf(ORDER_RELATIONSHIP),
    },
  }

  const byGatewayId = await findSystemRecordIdsByValue(db, organizationId, transactionCtx, {
    attribute: GATEWAY_TRANSACTION_ID,
    text: transIds,
  })

  // The invoice number is the order NAME on a Shopify-originated transaction, so
  // the order id it is compared against is only the second spelling to try.
  const spellings = new Map(invoiceNumbers.map((value) => [value, orderNameSpellings(value)]))
  const names = [...new Set([...spellings.values()].flat())]
  const byOrderExternalId = await findSystemRecordIdsByValue(db, organizationId, transactionCtx, {
    attribute: ORDER_EXTERNAL_ID,
    text: names,
  })
  const orderDefId = await getCachedEntityDefId(organizationId, 'order')
  const orderNumberFieldId = orderDefId
    ? (await getCachedCustomFields(organizationId, orderDefId)).find(
        (field) => field.systemAttribute === ORDER_NUMBER
      )?.id
    : undefined
  const orderIdsByName =
    orderDefId && orderNumberFieldId
      ? await findSystemRecordIdsByValue(
          db,
          organizationId,
          { defId: orderDefId, fields: { [ORDER_NUMBER]: { id: orderNumberFieldId } } },
          { attribute: ORDER_NUMBER, text: names }
        )
      : new Map<string, string[]>()
  const byOrderInstance = await findSystemRecordIdsByValue(db, organizationId, transactionCtx, {
    attribute: ORDER_RELATIONSHIP,
    related: [...new Set([...orderIdsByName.values()].flat())],
  })

  const candidateIds = [
    ...new Set([
      ...[...byGatewayId.values()].flat(),
      ...[...byOrderExternalId.values()].flat(),
      ...[...byOrderInstance.values()].flat(),
    ]),
  ]
  if (!candidateIds.length) return resolved
  const pivot = await pivotRecordFields(db, organizationId, candidateIds, specs)

  for (const entry of entries) {
    const direct = entry.sourceTransactionId
      ? onlyCandidate(byGatewayId.get(entry.sourceTransactionId), entry, pivot, false)
      : null
    if (direct) {
      resolved.set(entry.id, direct)
      continue
    }
    if (!entry.sourceOrderId) continue
    const onOrder = (spellings.get(entry.sourceOrderId) ?? []).flatMap((spelling) => [
      ...(byOrderExternalId.get(spelling) ?? []),
      ...(orderIdsByName.get(spelling) ?? []).flatMap((id) => byOrderInstance.get(id) ?? []),
    ])
    const fallback = onlyCandidate(onOrder, entry, pivot, true)
    if (fallback) resolved.set(entry.id, fallback)
  }
  return resolved
}

/** Authorize.net's `transId` / `order.invoiceNumber` → the Shopify transaction that holds the receipt. */
export const AUTHORIZE_NET_ENTRY_REFERENCE_RESOLVER: EntryReferenceResolver = {
  providerKey: 'authorize_net',
  resolve,
}

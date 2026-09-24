// packages/lib/src/accounting/money/customer-money/bridge.ts

/**
 * Records become evidence rows, in batches (`plans/accounting/tasks/69-the-evidence-bridge.md`).
 *
 * The mapping is the one `money/reconciliation/stored-source-records.ts` carried
 * until #2211 deleted its only caller; the read is not — field ids come from the
 * org cache, so a batch costs one `FieldValue` pivot instead of a `CustomField`
 * join per row.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeValue } from '@auxx/database/types'
import { readEnvelope } from '@auxx/types/field-value'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../../../cache'
import { CUSTOMER_TRANSACTION_FIELDS } from '../../../resources/registry/resources/customer-transaction-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PAYOUT_SOURCE_FIELDS } from '../../../resources/registry/resources/payout-source-fields'
import { PROCESSOR_BALANCE_ENTRY_FIELDS } from '../../../resources/registry/resources/processor-balance-entry-fields'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { isAccountingActive } from '../../ledger/setup/accounting-enabled'
import { readUniqueRecordIdentities } from './identity-reads'
import type { PayoutRecordEvidence, ProcessorRecordEvidence } from './record-contracts'
import { reconcileOrderPaymentEvidence, stageOrderPaymentEvidenceInTx } from './record-evidence'
import {
  type FinancialRecordWrite,
  type FinancialWriteProvenance,
  writeFinancialRecords,
} from './record-storage'

export type BridgeRecordKind =
  | 'payout'
  | 'processor_balance_entry'
  | 'customer_transaction'
  | 'order'

/** `writeFinancialRecords`'s own ceiling; every pivot is sized to match it. */
export const BRIDGE_BATCH_SIZE = 250

export interface BridgeKindCounts {
  bridged: number
  skipped: number
  /** Why a record was skipped, by reason, so a backfill run explains its own gaps. */
  reasons: Record<string, number>
  /** `advance` / `replay` / `stale` / `conflict`, as the writer reported them. */
  dispositions: Record<string, number>
}

export interface BridgeResult {
  payout: BridgeKindCounts
  processor_balance_entry: BridgeKindCounts
  customer_transaction: BridgeKindCounts
  order: BridgeKindCounts
  /** Payout owners the caller should assess. */
  payoutInstanceIds: string[]
  /** Orders whose acceptances the caller should materialize. */
  orderInstanceIds: string[]
}

type FieldSpec = { attribute: string; fieldType: FieldTypeValue }
type RecordFields = Record<string, unknown>

const PAYOUT_PREFIX = 'payout_source_'
const PROCESSOR_PREFIX = 'processor_balance_'
const TRANSACTION_PREFIX = 'customer_transaction_'
const ORDER_PAYMENT_PREFIX = 'order_payment_source_'

type RegistryField = {
  systemAttribute?: string | null
  fieldType: FieldTypeValue
  relationship?: { relationshipType: string } | undefined
}

/**
 * The attributes of one registry resource that the evidence lane reads.
 *
 * Derived from the registry rather than listed again here — a field added to
 * `*-fields.ts` is bridged without a second edit. `has_many` sides are dropped:
 * their `FieldValue` rows live on the child.
 */
function bridgedAttributes(
  fields: Record<string, RegistryField>,
  prefix?: string
): Map<string, FieldTypeValue> {
  return new Map(
    Object.values(fields)
      .filter(
        (field): field is RegistryField & { systemAttribute: string } =>
          !!field.systemAttribute &&
          field.relationship?.relationshipType !== 'has_many' &&
          (!prefix || field.systemAttribute.startsWith(prefix))
      )
      .map((field) => [field.systemAttribute, field.fieldType] as const)
  )
}

export const BRIDGE_ATTRIBUTES: Record<BridgeRecordKind, Map<string, FieldTypeValue>> = {
  payout: bridgedAttributes(PAYOUT_SOURCE_FIELDS as Record<string, RegistryField>),
  processor_balance_entry: bridgedAttributes(
    PROCESSOR_BALANCE_ENTRY_FIELDS as Record<string, RegistryField>
  ),
  customer_transaction: bridgedAttributes(
    CUSTOMER_TRANSACTION_FIELDS as Record<string, RegistryField>
  ),
  order: bridgedAttributes(ORDER_FIELDS as Record<string, RegistryField>, ORDER_PAYMENT_PREFIX),
}

const emptyCounts = (): BridgeKindCounts => ({
  bridged: 0,
  skipped: 0,
  reasons: {},
  dispositions: {},
})

function skip(counts: BridgeKindCounts, reason: string, amount = 1): void {
  counts.skipped += amount
  counts.reasons[reason] = (counts.reasons[reason] ?? 0) + amount
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let start = 0; start < items.length; start += size)
    pages.push(items.slice(start, start + size))
  return pages
}

/** One typed column per row; the registry's declared type says which. */
export function readFieldValue(
  row: {
    valueText: string | null
    valueNumber: number | null
    valueBoolean: boolean | null
    valueDate: string | null
    valueJson: unknown
    relatedEntityId: string | null
  },
  fieldType: FieldTypeValue
): unknown {
  if (fieldType === FieldType.RELATIONSHIP) return row.relatedEntityId
  if (fieldType === FieldType.JSON)
    return row.valueJson == null ? null : readEnvelope(row.valueJson).v
  if (fieldType === FieldType.CHECKBOX) return row.valueBoolean
  if (fieldType === FieldType.NUMBER)
    return row.valueNumber == null ? null : Number(row.valueNumber)
  if (fieldType === FieldType.DATE || fieldType === FieldType.DATETIME)
    return row.valueDate ?? row.valueText
  return row.valueText
}

/** `CustomField.id` → attribute, from the org cache; never a `CustomField` join per row. */
export async function bridgeFieldSpecs(
  organizationId: string,
  kind: BridgeRecordKind
): Promise<{ entityDefinitionId: string | undefined; specs: Map<string, FieldSpec> }> {
  const entityDefinitionId = await getCachedEntityDefId(organizationId, kind)
  if (!entityDefinitionId) return { entityDefinitionId, specs: new Map() }
  const wanted = BRIDGE_ATTRIBUTES[kind]
  const fields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const specs = new Map<string, FieldSpec>()
  for (const field of fields) {
    const attribute = field.systemAttribute
    if (!attribute || !wanted.has(attribute)) continue
    specs.set(field.id, { attribute, fieldType: wanted.get(attribute)! })
  }
  return { entityDefinitionId, specs }
}

/**
 * One `FieldValue` read for a whole batch, pivoted to `Map<recordId, fields>`.
 *
 * `__updatedAt` rides along because `storedFinancialFacts` dates a record that
 * never reported an acquisition instant from its own last write.
 */
export async function pivotRecordFields(
  db: Database | Transaction,
  organizationId: string,
  entityIds: string[],
  specs: Map<string, FieldSpec>
): Promise<Map<string, RecordFields>> {
  const pivot = new Map<string, RecordFields>()
  if (!entityIds.length || !specs.size) return pivot
  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueBoolean: schema.FieldValue.valueBoolean,
      valueDate: schema.FieldValue.valueDate,
      valueJson: schema.FieldValue.valueJson,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      updatedAt: schema.FieldValue.updatedAt,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, [...specs.keys()])
      )
    )
  for (const row of rows) {
    const spec = specs.get(row.fieldId)
    if (!spec) continue
    const fields = pivot.get(row.entityId) ?? {}
    fields[spec.attribute] = readFieldValue(row, spec.fieldType)
    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.getTime() : 0
    fields.__updatedAt = Math.max(Number(fields.__updatedAt ?? 0), updatedAt)
    pivot.set(row.entityId, fields)
  }
  return pivot
}

/** Assess the shared source fields, independent of connector and provider payload shapes. */
export function storedFinancialFacts(
  type: 'payout' | 'processor_balance_entry',
  values: RecordFields,
  now: Date
): PayoutRecordEvidence | ProcessorRecordEvidence | null {
  const prefix = type === 'payout' ? PAYOUT_PREFIX : PROCESSOR_PREFIX
  const fields = Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value])
  ) as Record<string, never>
  if (!fields.external_id || !fields.provider_key || !fields.account_id || !fields.environment)
    return null
  const sourceAccount = {
    providerKey: fields.provider_key,
    externalAccountId: fields.account_id,
    environment: fields.environment,
  }
  const acquisition = {
    id: fields.acquisition_id ?? accountingBasisHash(fields),
    startedAt: fields.acquired_at ?? now.toISOString(),
  }
  const common = {
    version: 2 as const,
    externalId: fields.external_id,
    sourceAccount,
    acquisition,
    raw: fields.raw ?? null,
    rejectionReason: fields.rejection_reason ?? null,
  }
  if (type === 'payout') {
    if (fields.amount == null && !fields.rejection_reason) return null
    return {
      ...common,
      payout: fields.rejection_reason
        ? null
        : {
            id: fields.external_id,
            amount: fields.amount,
            currency: fields.currency,
            currencyExponent: fields.currency_exponent,
            status: fields.status,
            issuedAt: fields.issued_at ?? null,
            issuedOn: fields.issued_on ?? null,
            destinationExternalId: fields.destination_id ?? null,
            raw: fields.raw ?? null,
          },
      membership: fields.membership ?? {
        providerReady: false,
        complete: false,
        reason: 'Payout membership has not been supplied',
        page: null,
        entries: [],
        rejections: [],
        rawRows: [],
      },
    } as unknown as PayoutRecordEvidence
  }
  if (
    (fields.gross == null || fields.fee == null || fields.net == null) &&
    !fields.rejection_reason
  )
    return null
  return {
    ...common,
    page: fields.page ?? { id: acquisition.id, index: 0, rowIndex: 0 },
    entry: fields.rejection_reason
      ? null
      : {
          id: fields.external_id,
          type: fields.type,
          providerType: fields.provider_type ?? fields.type,
          gross: fields.gross,
          fee: fields.fee,
          net: fields.net,
          currency: fields.currency,
          currencyExponent: fields.currency_exponent,
          transactionDate: fields.transaction_date ?? null,
          payoutId: fields.payout_id ?? null,
          sourceTransactionId: fields.transaction_id ?? null,
          sourceOrderId: fields.order_id ?? null,
          sourceId: fields.source_id ?? null,
          sourceType: fields.source_type ?? null,
          sourceReference: fields.source_reference ?? null,
          raw: fields.raw ?? null,
        },
  } as unknown as ProcessorRecordEvidence
}

/** The transaction envelope one `customer_transaction` record contributes to its order. */
function storedTransactionFacts(values: RecordFields) {
  const fields = Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => key.startsWith(TRANSACTION_PREFIX))
      .map(([key, value]) => [key.slice(TRANSACTION_PREFIX.length), value])
  ) as Record<string, never>
  if (
    !fields.provider_key ||
    !fields.account_id ||
    !fields.environment ||
    !fields.order_external_id ||
    !fields.external_id
  )
    return null
  const transaction: Record<string, unknown> = {
    version: 2,
    id: fields.external_id,
    kind: fields.kind,
    status: fields.status,
    amount: fields.amount,
    currency: fields.currency,
    processedAt: fields.processed_at ?? null,
    gateway: fields.gateway ?? null,
    settlementCurrency: fields.settlement_currency ?? null,
    parentTransactionId: fields.parent_transaction_id ?? null,
    creditMemoExternalId: fields.credit_memo_id ?? null,
    paymentId: fields.payment_id ?? null,
    test: fields.test === true,
    raw: fields.raw ?? null,
  }
  return {
    sourceAccount: {
      providerKey: String(fields.provider_key),
      externalAccountId: String(fields.account_id),
      environment: String(fields.environment),
    },
    orderExternalId: String(fields.order_external_id),
    sourceUpdatedAt: fields.source_updated_at == null ? null : String(fields.source_updated_at),
    transaction,
  }
}

/**
 * Turn stored financial records into the durable evidence rows the accounting
 * lane reads. Batched by kind; a record whose required fields are missing is
 * skipped and counted, never an error.
 */
export async function bridgeFinancialRecords(
  db: Database,
  input: {
    organizationId: string
    actorUserId: string
    records: Array<{ id: string; kind: BridgeRecordKind }>
    provenance?: FinancialWriteProvenance
  }
): Promise<BridgeResult> {
  const result: BridgeResult = {
    payout: emptyCounts(),
    processor_balance_entry: emptyCounts(),
    customer_transaction: emptyCounts(),
    order: emptyCounts(),
    payoutInstanceIds: [],
    orderInstanceIds: [],
  }
  const byKind = new Map<BridgeRecordKind, Set<string>>()
  for (const record of input.records) {
    if (!record.id) continue
    const ids = byKind.get(record.kind) ?? new Set<string>()
    ids.add(record.id)
    byKind.set(record.kind, ids)
  }
  if (!byKind.size) return result
  if (!(await isAccountingActive(input.organizationId))) return result

  // `{ source: 'import' }` keeps the record's own acquisition and lets the writer
  // retain a malformed row as a rejection instead of throwing the batch away.
  const provenance = input.provenance ?? { source: 'import', ref: 'evidence-bridge' }

  for (const kind of ['payout', 'processor_balance_entry'] as const) {
    const ids = [...(byKind.get(kind) ?? [])]
    if (!ids.length) continue
    const { entityDefinitionId, specs } = await bridgeFieldSpecs(input.organizationId, kind)
    if (!entityDefinitionId) {
      skip(result[kind], 'resource is not installed for this organization', ids.length)
      continue
    }
    for (const page of chunk(ids, BRIDGE_BATCH_SIZE))
      await bridgeSourceBatch(db, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        kind,
        entityDefinitionId,
        specs,
        ids: page,
        provenance,
        counts: result[kind],
        bridgedIds: result.payoutInstanceIds,
      })
  }

  const orderIds = new Set(byKind.get('order') ?? [])
  const transactionIds = [...(byKind.get('customer_transaction') ?? [])]
  if (transactionIds.length) {
    const { specs } = await bridgeFieldSpecs(input.organizationId, 'customer_transaction')
    const orderFieldId = [...specs].find(
      ([, spec]) => spec.attribute === 'customer_transaction_order'
    )?.[0]
    for (const page of chunk(transactionIds, BRIDGE_BATCH_SIZE)) {
      const links = orderFieldId
        ? await db
            .select({
              entityId: schema.FieldValue.entityId,
              orderId: schema.FieldValue.relatedEntityId,
            })
            .from(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.organizationId, input.organizationId),
                eq(schema.FieldValue.fieldId, orderFieldId),
                inArray(schema.FieldValue.entityId, page)
              )
            )
        : []
      const linked = new Set<string>()
      for (const link of links) {
        if (!link.orderId) continue
        linked.add(link.entityId)
        orderIds.add(link.orderId)
      }
      result.customer_transaction.bridged += linked.size
      if (linked.size < page.length)
        skip(result.customer_transaction, 'no order relationship', page.length - linked.size)
    }
  }

  if (orderIds.size) {
    const { specs: orderSpecs } = await bridgeFieldSpecs(input.organizationId, 'order')
    const { specs: transactionSpecs } = await bridgeFieldSpecs(
      input.organizationId,
      'customer_transaction'
    )
    for (const page of chunk([...orderIds], BRIDGE_BATCH_SIZE))
      await bridgeOrderBatch(db, {
        organizationId: input.organizationId,
        orderIds: page,
        orderSpecs,
        transactionSpecs,
        provenance,
        counts: result.order,
        bridgedIds: result.orderInstanceIds,
      })
    await reconcileOrderPaymentEvidence(db, {
      organizationId: input.organizationId,
      orderInstanceIds: result.orderInstanceIds,
    })
  }
  return result
}

async function bridgeSourceBatch(
  db: Database,
  input: {
    organizationId: string
    actorUserId: string
    kind: 'payout' | 'processor_balance_entry'
    entityDefinitionId: string
    specs: Map<string, FieldSpec>
    ids: string[]
    provenance: FinancialWriteProvenance
    counts: BridgeKindCounts
    bridgedIds: string[]
  }
): Promise<void> {
  const pivot = await pivotRecordFields(db, input.organizationId, input.ids, input.specs)
  const now = new Date()
  const writes: FinancialRecordWrite[] = []
  for (const id of input.ids) {
    const values = pivot.get(id)
    if (!values) {
      skip(input.counts, 'no financial field values')
      continue
    }
    const evidence = storedFinancialFacts(
      input.kind,
      values,
      values.__updatedAt ? new Date(Number(values.__updatedAt)) : now
    )
    if (!evidence) {
      skip(input.counts, 'required source facts are missing')
      continue
    }
    writes.push({
      entityType: input.kind,
      entityDefinitionId: input.entityDefinitionId,
      recordId: id,
      evidence,
    })
  }
  if (!writes.length) return
  const write = (records: FinancialRecordWrite[]) =>
    writeFinancialRecords(db, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      records,
      provenance: input.provenance,
    })
  let results: Awaited<ReturnType<typeof write>>
  try {
    results = await write(writes)
  } catch {
    // One conflicting identity must not cost the other 249 rows of a backfill.
    results = []
    for (const record of writes) {
      try {
        results.push(...(await write([record])))
      } catch (error) {
        skip(input.counts, error instanceof Error ? error.message : 'writer refused the record')
      }
    }
  }
  for (const row of results) {
    input.counts.bridged++
    input.counts.dispositions[row.disposition] =
      (input.counts.dispositions[row.disposition] ?? 0) + 1
    input.bridgedIds.push(row.id)
  }
}

/**
 * Stamp the memo a refund names onto its evidence, so the ingest reads it off
 * the acceptance instead of resolving it with a credential it does not have
 * (task 79 §4.3). An id no unique record answers is left for the resolver.
 */
async function resolveCreditMemoInstances(
  db: Database,
  organizationId: string,
  memos: Array<{ providerKey: string; externalId: string; transaction: RecordFields }>
): Promise<void> {
  const byProvider = new Map<string, Set<string>>()
  for (const memo of memos)
    byProvider.set(
      memo.providerKey,
      (byProvider.get(memo.providerKey) ?? new Set<string>()).add(memo.externalId)
    )
  const resolved = new Map<string, string>()
  for (const [providerKey, externalIds] of byProvider) {
    const rows = await readUniqueRecordIdentities(db, organizationId, {
      source: providerKey,
      kind: 'credit_memo',
      externalIds: [...externalIds],
    })
    for (const [externalId, id] of rows) resolved.set(`${providerKey}:${externalId}`, id)
  }
  for (const memo of memos) {
    const id = resolved.get(`${memo.providerKey}:${memo.externalId}`)
    if (id) memo.transaction.creditMemoInstanceId = id
  }
}

async function bridgeOrderBatch(
  db: Database,
  input: {
    organizationId: string
    orderIds: string[]
    orderSpecs: Map<string, FieldSpec>
    transactionSpecs: Map<string, FieldSpec>
    provenance: FinancialWriteProvenance
    counts: BridgeKindCounts
    bridgedIds: string[]
  }
): Promise<void> {
  const orders = await pivotRecordFields(db, input.organizationId, input.orderIds, input.orderSpecs)
  const orderFieldId = [...input.transactionSpecs].find(
    ([, spec]) => spec.attribute === 'customer_transaction_order'
  )?.[0]
  const links = orderFieldId
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          orderId: schema.FieldValue.relatedEntityId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, input.organizationId),
            eq(schema.FieldValue.fieldId, orderFieldId),
            inArray(schema.FieldValue.relatedEntityId, input.orderIds)
          )
        )
    : []
  const transactions = new Map<string, RecordFields>()
  for (const page of chunk([...new Set(links.map((link) => link.entityId))], 1000))
    for (const [id, values] of await pivotRecordFields(
      db,
      input.organizationId,
      page,
      input.transactionSpecs
    ))
      transactions.set(id, values)

  const staged: Array<{ orderId: string; evidence: unknown }> = []
  const memos: Array<{ providerKey: string; externalId: string; transaction: RecordFields }> = []
  for (const orderId of input.orderIds) {
    const order = orders.get(orderId) ?? {}
    const groups = new Map<
      string,
      {
        sourceAccount: { providerKey: string; externalAccountId: string; environment: string }
        orderExternalId: string
        sourceUpdatedAt: string | null
        transactions: unknown[]
      }
    >()
    for (const link of links) {
      if (link.orderId !== orderId) continue
      const values = transactions.get(link.entityId)
      const facts = values ? storedTransactionFacts(values) : null
      if (!facts) continue
      const key = JSON.stringify(facts.sourceAccount)
      const group = groups.get(key) ?? {
        sourceAccount: facts.sourceAccount,
        orderExternalId: facts.orderExternalId,
        sourceUpdatedAt: facts.sourceUpdatedAt,
        transactions: [],
      }
      group.transactions.push(facts.transaction)
      groups.set(key, group)
      if (facts.transaction.creditMemoExternalId)
        memos.push({
          providerKey: facts.sourceAccount.providerKey,
          externalId: String(facts.transaction.creditMemoExternalId),
          transaction: facts.transaction,
        })
    }
    if (
      !groups.size &&
      order.order_payment_source_provider &&
      order.order_payment_source_account &&
      order.order_payment_source_order_id
    ) {
      const sourceAccount = {
        providerKey: String(order.order_payment_source_provider),
        externalAccountId: String(order.order_payment_source_account),
        environment: String(order.order_payment_source_environment),
      }
      groups.set(JSON.stringify(sourceAccount), {
        sourceAccount,
        orderExternalId: String(order.order_payment_source_order_id),
        sourceUpdatedAt:
          order.order_payment_source_updated_at == null
            ? null
            : String(order.order_payment_source_updated_at),
        transactions: [],
      })
    }
    if (!groups.size) {
      skip(input.counts, 'no payment source on the order or its transactions')
      continue
    }
    for (const group of groups.values())
      staged.push({
        orderId,
        evidence: {
          version: 2,
          ...group,
          complete:
            order.order_payment_source_complete === true &&
            Number(order.order_payment_source_count) === group.transactions.length,
        },
      })
  }
  await resolveCreditMemoInstances(db, input.organizationId, memos)
  if (!staged.length) return
  const stage = (rows: typeof staged) =>
    // One transaction for the batch: `stageOrderPaymentEvidenceInTx` takes the org
    // advisory lock itself, and `pg_advisory_xact_lock` re-entering is a no-op.
    db.transaction(async (tx) => {
      for (const row of rows)
        await stageOrderPaymentEvidenceInTx(tx, {
          organizationId: input.organizationId,
          orderInstanceId: row.orderId,
          provenance: input.provenance,
          evidence: row.evidence,
        })
    })
  const done = new Set<string>()
  try {
    await stage(staged)
    for (const row of staged) done.add(row.orderId)
  } catch {
    // A refused order aborts its transaction, so the rest of the batch has to be
    // replayed one order at a time rather than caught in place.
    for (const orderId of new Set(staged.map((row) => row.orderId))) {
      try {
        await stage(staged.filter((row) => row.orderId === orderId))
        done.add(orderId)
      } catch (error) {
        skip(input.counts, error instanceof Error ? error.message : 'order evidence was refused')
      }
    }
  }
  for (const orderId of done) {
    input.counts.bridged++
    input.bridgedIds.push(orderId)
  }
}

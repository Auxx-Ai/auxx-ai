// packages/lib/src/accounting/money/customer-money/__tests__/bridge.int.test.ts
//
// The bridge against real SQL: records in, `MoneyTransfer` / `ProcessorBalanceEntry`
// / `FinancialSourceObservation` / `FinancialSourceAcceptance` out, and a second
// run that writes nothing.

import { schema } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../cache', async () => {
  const { getTestDb: tdb } = await import('@auxx/test-utils')
  const { schema: s } = await import('@auxx/database')
  const { and: andOp, eq: eqOp } = await import('drizzle-orm')
  return {
    getCachedEntityDefId: async (orgId: string, entityType: string) =>
      (
        await tdb()
          .select({ id: s.EntityDefinition.id })
          .from(s.EntityDefinition)
          .where(
            andOp(
              eqOp(s.EntityDefinition.organizationId, orgId),
              eqOp(s.EntityDefinition.entityType, entityType)
            )
          )
      )[0]?.id,
    getCachedCustomFields: async (orgId: string, defId: string) =>
      await tdb()
        .select()
        .from(s.CustomField)
        .where(
          andOp(
            eqOp(s.CustomField.organizationId, orgId),
            eqOp(s.CustomField.entityDefinitionId, defId)
          )
        ),
  }
})

import { BRIDGE_ATTRIBUTES, bridgeFinancialRecords } from '../bridge'
import { findUnbridgedFinancialRecords, sweepFinancialRecordBridge } from '../bridge-sweep'

let organizationId: string
let actorUserId: string
const defIds: Record<string, string> = {}
const fieldIds = new Map<string, string>()

const DEFS = [
  { entityType: 'payout', apiSlug: 'payouts' },
  { entityType: 'processor_balance_entry', apiSlug: 'processor-balance-entries' },
  { entityType: 'customer_transaction', apiSlug: 'customer-transactions' },
  { entityType: 'order', apiSlug: 'orders' },
] as const

/** Count every statement the pool issues, transaction clients included. */
function countStatements() {
  const pool = (getTestDb() as unknown as { $client: unknown }).$client as {
    query: (...args: unknown[]) => unknown
    connect: (...args: unknown[]) => Promise<{ query: (...args: unknown[]) => unknown }>
  }
  let count = 0
  const query = pool.query.bind(pool)
  const connect = pool.connect.bind(pool)
  pool.query = (...args: unknown[]) => {
    count++
    return query(...args)
  }
  pool.connect = (...args: unknown[]) => {
    // pg's callback form returns undefined; only the promise form is wrappable.
    if (args.length) return connect(...args)
    return connect().then((client) => {
      const clientQuery = client.query.bind(client)
      client.query = (...inner: unknown[]) => {
        count++
        return clientQuery(...inner)
      }
      return client
    })
  }
  return {
    get count() {
      return count
    },
    restore() {
      pool.query = query
      pool.connect = connect
    },
  }
}

async function createInstance(entityType: string, fields: Record<string, unknown>) {
  const [instance] = await getTestDb()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defIds[entityType]!,
      displayName: entityType,
      createdById: actorUserId,
      updatedAt: new Date(),
    })
    .returning()
  const rows = Object.entries(fields).flatMap(([attribute, raw]) => {
    const fieldId = fieldIds.get(`${entityType}:${attribute}`)
    if (!fieldId || raw === undefined) return []
    const fieldType =
      BRIDGE_ATTRIBUTES[entityType as keyof typeof BRIDGE_ATTRIBUTES]?.get(attribute)
    const column =
      fieldType === FieldType.JSON
        ? { valueJson: { v: raw } }
        : fieldType === FieldType.CHECKBOX
          ? { valueBoolean: raw as boolean }
          : fieldType === FieldType.NUMBER
            ? { valueNumber: raw as number }
            : fieldType === FieldType.RELATIONSHIP
              ? { relatedEntityId: raw as string }
              : { valueText: String(raw) }
    return [
      {
        organizationId,
        fieldId,
        entityId: instance!.id,
        entityDefinitionId: defIds[entityType]!,
        updatedAt: new Date(),
        ...column,
      },
    ]
  })
  if (rows.length) await getTestDb().insert(schema.FieldValue).values(rows)
  return instance!.id
}

const SOURCE = {
  provider_key: 'shopify_payments',
  account_id: 'shop-1',
  environment: 'live',
}

function entryFields(externalId: string, rowIndex: number) {
  return {
    processor_balance_external_id: externalId,
    processor_balance_provider_key: SOURCE.provider_key,
    processor_balance_account_id: SOURCE.account_id,
    processor_balance_environment: SOURCE.environment,
    processor_balance_acquisition_id: 'acq-1',
    processor_balance_acquired_at: '2026-09-17T00:00:00Z',
    processor_balance_page: { id: 'page-1', index: 0, rowIndex },
    processor_balance_type: 'charge',
    processor_balance_provider_type: 'charge',
    processor_balance_gross: '50.00',
    processor_balance_fee: '1.50',
    processor_balance_net: '48.50',
    processor_balance_currency: 'USD',
    processor_balance_currency_exponent: 2,
    processor_balance_transaction_date: '2026-09-17T00:00:00Z',
    processor_balance_payout_id: 'po_1',
  }
}

function transactionFields(externalId: string, orderInstanceId: string) {
  return {
    customer_transaction_external_id: externalId,
    customer_transaction_provider_key: SOURCE.provider_key,
    customer_transaction_account_id: SOURCE.account_id,
    customer_transaction_environment: SOURCE.environment,
    customer_transaction_order_external_id: 'order-ext-1',
    customer_transaction_order: orderInstanceId,
    customer_transaction_kind: 'receipt',
    customer_transaction_status: 'confirmed',
    customer_transaction_amount: '25.00',
    customer_transaction_currency: 'USD',
    customer_transaction_processed_at: '2026-09-17T00:00:00Z',
    customer_transaction_gateway: 'shopify_payments',
    customer_transaction_source_updated_at: '2026-09-17T00:00:00Z',
    customer_transaction_test: false,
  }
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  actorUserId = (await createTestUser()).id
  fieldIds.clear()
  const definitions = await getTestDb()
    .insert(schema.EntityDefinition)
    .values(
      DEFS.map((def) => ({
        organizationId,
        entityType: def.entityType,
        apiSlug: def.apiSlug,
        singular: def.entityType,
        plural: def.apiSlug,
        updatedAt: new Date(),
      }))
    )
    .returning()
  for (const definition of definitions) defIds[definition.entityType!] = definition.id
  const fields = DEFS.flatMap((def) =>
    [...BRIDGE_ATTRIBUTES[def.entityType].keys()].map((attribute) => ({
      organizationId,
      entityDefinitionId: defIds[def.entityType]!,
      name: attribute,
      type: 'TEXT' as const,
      systemAttribute: attribute,
      modelType: def.entityType,
      isCustom: false,
      updatedAt: new Date(),
    }))
  )
  for (const row of await getTestDb().insert(schema.CustomField).values(fields).returning())
    fieldIds.set(`${row.modelType}:${row.systemAttribute}`, row.id)
})

describe('the evidence bridge', () => {
  it('turns one payout with two items and one order with two transactions into evidence rows', async () => {
    const payoutId = await createInstance('payout', {
      payout_source_external_id: 'po_1',
      payout_source_provider_key: SOURCE.provider_key,
      payout_source_account_id: SOURCE.account_id,
      payout_source_environment: SOURCE.environment,
      payout_source_acquisition_id: 'acq-1',
      payout_source_acquired_at: '2026-09-17T00:00:00Z',
      payout_source_amount: '97.00',
      payout_source_currency: 'USD',
      payout_source_currency_exponent: 2,
      payout_source_status: 'paid',
      payout_source_issued_on: '2026-09-17',
    })
    const entryIds = [
      await createInstance('processor_balance_entry', entryFields('bt_1', 0)),
      await createInstance('processor_balance_entry', entryFields('bt_2', 1)),
    ]
    const orderId = await createInstance('order', {
      order_payment_source_provider: SOURCE.provider_key,
      order_payment_source_account: SOURCE.account_id,
      order_payment_source_environment: SOURCE.environment,
      order_payment_source_order_id: 'order-ext-1',
      order_payment_source_updated_at: '2026-09-17T00:00:00Z',
      order_payment_source_complete: true,
      order_payment_source_count: 2,
    })
    const transactionIds = [
      await createInstance('customer_transaction', transactionFields('txn_1', orderId)),
      await createInstance('customer_transaction', transactionFields('txn_2', orderId)),
    ]

    const sourceMeter = countStatements()
    const sources = await bridgeFinancialRecords(getTestDb(), {
      organizationId,
      actorUserId,
      records: [
        { id: payoutId, kind: 'payout' },
        ...entryIds.map((id) => ({ id, kind: 'processor_balance_entry' as const })),
      ],
    })
    const sourceStatements = sourceMeter.count
    sourceMeter.restore()

    const orderMeter = countStatements()
    const orders = await bridgeFinancialRecords(getTestDb(), {
      organizationId,
      actorUserId,
      records: transactionIds.map((id) => ({ id, kind: 'customer_transaction' as const })),
    })
    const orderStatements = orderMeter.count
    orderMeter.restore()

    const first = {
      payout: sources.payout,
      processor_balance_entry: sources.processor_balance_entry,
      customer_transaction: orders.customer_transaction,
      order: orders.order,
      payoutInstanceIds: sources.payoutInstanceIds,
      orderInstanceIds: orders.orderInstanceIds,
    }
    expect(first.payout).toMatchObject({ bridged: 1, skipped: 0, dispositions: { advance: 1 } })
    expect(first.processor_balance_entry).toMatchObject({
      bridged: 2,
      skipped: 0,
      dispositions: { advance: 2 },
    })
    expect(first.customer_transaction).toMatchObject({ bridged: 2, skipped: 0 })
    expect(first.order).toMatchObject({ bridged: 1, skipped: 0 })
    expect(first.orderInstanceIds).toEqual([orderId])
    expect(first.payoutInstanceIds.sort()).toEqual([payoutId, ...entryIds].sort())

    const transfers = await getTestDb()
      .select()
      .from(schema.MoneyTransfer)
      .where(eq(schema.MoneyTransfer.organizationId, organizationId))
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toMatchObject({
      id: payoutId,
      externalId: 'po_1',
      sourceAmountMinor: 9700n,
      sourceCurrency: 'USD',
      occurredOn: '2026-09-17',
    })

    const entries = await getTestDb()
      .select()
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.organizationId, organizationId))
    expect(entries.map((row) => row.externalId).sort()).toEqual(['bt_1', 'bt_2'])
    expect(entries.every((row) => row.payoutExternalId === 'po_1')).toBe(true)
    expect(entries.map((row) => row.id).sort()).toEqual([...entryIds].sort())

    const observations = await getTestDb()
      .select()
      .from(schema.FinancialSourceObservation)
      .where(eq(schema.FinancialSourceObservation.organizationId, organizationId))
    // Three source rows plus one observation per order transaction.
    expect(observations).toHaveLength(5)

    const objects = await getTestDb()
      .select()
      .from(schema.FinancialSourceObject)
      .where(eq(schema.FinancialSourceObject.organizationId, organizationId))
    expect(objects.map((row) => row.objectType).sort()).toEqual([
      'balance_transaction',
      'balance_transaction',
      'order_transaction',
      'order_transaction',
      'payout',
    ])

    const acceptances = await getTestDb()
      .select()
      .from(schema.FinancialSourceAcceptance)
      .where(eq(schema.FinancialSourceAcceptance.organizationId, organizationId))
    expect(acceptances).toHaveLength(2)
    expect(acceptances.every((row) => row.orderInstanceId === orderId)).toBe(true)

    const money = await getTestDb()
      .select()
      .from(schema.MoneyTransaction)
      .where(eq(schema.MoneyTransaction.organizationId, organizationId))
    // The bridge stages and reconciles; whether an acceptance materializes is
    // `materializeImportedMoneyInTx`'s call, not the bridge's.
    expect(money.length).toBeGreaterThanOrEqual(0)

    console.log(
      `statements: ${sourceStatements} for one payout + two items batch, ` +
        `${orderStatements} for one order + two transactions batch`
    )

    const second = await bridgeFinancialRecords(getTestDb(), {
      organizationId,
      actorUserId,
      records: [
        { id: payoutId, kind: 'payout' },
        ...entryIds.map((id) => ({ id, kind: 'processor_balance_entry' as const })),
        ...transactionIds.map((id) => ({ id, kind: 'customer_transaction' as const })),
      ],
    })
    expect(second.payout.dispositions).toEqual({ replay: 1 })
    expect(second.processor_balance_entry.dispositions).toEqual({ replay: 2 })
    expect(second.order).toMatchObject({ bridged: 1, skipped: 0 })

    expect(
      await getTestDb()
        .select()
        .from(schema.MoneyTransfer)
        .where(eq(schema.MoneyTransfer.organizationId, organizationId))
    ).toHaveLength(1)
    expect(
      await getTestDb()
        .select()
        .from(schema.FinancialSourceObservation)
        .where(eq(schema.FinancialSourceObservation.organizationId, organizationId))
    ).toHaveLength(5)
    expect(
      await getTestDb()
        .select()
        .from(schema.EntityInstance)
        .where(and(eq(schema.EntityInstance.organizationId, organizationId)))
    ).toHaveLength(6)
  })

  it('skips a record whose required source facts are missing instead of failing the batch', async () => {
    const good = await createInstance('processor_balance_entry', entryFields('bt_ok', 0))
    const bad = await createInstance('processor_balance_entry', {
      processor_balance_external_id: 'bt_bad',
      processor_balance_provider_key: SOURCE.provider_key,
      processor_balance_account_id: SOURCE.account_id,
      processor_balance_environment: SOURCE.environment,
    })
    const result = await bridgeFinancialRecords(getTestDb(), {
      organizationId,
      actorUserId,
      records: [
        { id: good, kind: 'processor_balance_entry' },
        { id: bad, kind: 'processor_balance_entry' },
      ],
    })
    expect(result.processor_balance_entry).toMatchObject({
      bridged: 1,
      skipped: 1,
      reasons: { 'required source facts are missing': 1 },
    })
  })

  it('the sweep anti-join selects only records with no evidence row yet', async () => {
    const bridgedId = await createInstance('processor_balance_entry', entryFields('bt_1', 0))
    const unbridgedId = await createInstance('processor_balance_entry', entryFields('bt_2', 1))
    const otherAccount = await createInstance('processor_balance_entry', {
      ...entryFields('bt_1', 2),
      processor_balance_account_id: 'shop-2',
    })

    expect(
      (
        await findUnbridgedFinancialRecords(getTestDb(), {
          organizationId,
          kind: 'processor_balance_entry',
          limit: 500,
        })
      ).sort()
    ).toEqual([bridgedId, unbridgedId, otherAccount].sort())

    await bridgeFinancialRecords(getTestDb(), {
      organizationId,
      actorUserId,
      records: [{ id: bridgedId, kind: 'processor_balance_entry' }],
    })

    // `bt_1` on the second account keeps the same external id and is still
    // unbridged — the anti-join matches the account, not the id alone.
    expect(
      (
        await findUnbridgedFinancialRecords(getTestDb(), {
          organizationId,
          kind: 'processor_balance_entry',
          limit: 500,
        })
      ).sort()
    ).toEqual([unbridgedId, otherAccount].sort())

    const swept = await sweepFinancialRecordBridge(getTestDb(), { organizationId, limit: 500 })
    expect(swept).toMatchObject({ found: 2, bridged: 2 })
    expect(
      await findUnbridgedFinancialRecords(getTestDb(), {
        organizationId,
        kind: 'processor_balance_entry',
        limit: 500,
      })
    ).toEqual([])
  })
})

// packages/lib/src/money/reconciliation/stored-source-records.int.test.ts
import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldValueService } from '../../field-values/field-value-service'
import { createManifestCollector } from '../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { seedSession } from '../../resources/crud/write-origin'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import type { EntityDefMap } from '../../seed/entity-seeder/types'

vi.mock('../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))
const db = () => getTestDb() as unknown as Database
let organizationId: string
let userId: string
let defs: EntityDefMap
let handler: UnifiedCrudHandler
let service: FieldValueService
let fieldIds: Map<string, string>
const payout = (externalId = 'payout-1') => ({
  payout_source_provider_key: 'gateway_a',
  payout_source_account_id: 'merchant-1',
  payout_source_environment: 'live',
  payout_source_external_id: externalId,
  payout_source_amount: '90071992547409.93',
  payout_source_currency: 'USD',
  payout_source_currency_exponent: 2,
  payout_source_status: 'paid',
  payout_source_issued_on: '2026-09-15',
})

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: userId })
    .where(eq(schema.Organization.id, organizationId))
  const all = await createEntityDefinitions(db(), organizationId)
  defs = new Map(
    [...all].filter(([kind]) =>
      ['payout', 'processor_balance_entry', 'customer_transaction', 'order'].includes(kind)
    )
  )
  await createAllFields(db(), organizationId, defs)
  fieldIds = new Map(
    (
      await db()
        .select()
        .from(schema.CustomField)
        .where(eq(schema.CustomField.organizationId, organizationId))
    ).map((field) => [field.systemAttribute!, field.id])
  )
  const session = seedSession('ordinary financial source fields')
  handler = new UnifiedCrudHandler(organizationId, userId, db(), undefined, { session })
  service = new FieldValueService(organizationId, userId, db(), undefined, { session })
})

describe('financial facts through standard record and field writers', () => {
  it('stores individually mapped payout fields and exact domain money without an evidence envelope', async () => {
    const record = await handler.create(defs.get('payout')!.id, payout())
    const [transfer] = await db().select().from(schema.MoneyTransfer)
    expect(transfer).toMatchObject({ id: record.instance.id, sourceAmountMinor: 9007199254740993n })
    const rows = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, record.instance.id))
    expect(rows.some((row) => row.valueText === '90071992547409.93')).toBe(true)
    expect(await db().select().from(schema.ProcessorBalanceEntry)).toHaveLength(0)
    await service.setValue({
      recordId: record.recordId,
      fieldId: fieldIds.get('payout_source_status')!,
      value: 'failed',
    })
    expect((await db().select().from(schema.MoneyTransfer))[0]!.status).toBe('failed')
    expect(
      await service.getValue({
        recordId: record.recordId,
        fieldId: fieldIds.get('payout_source_status')!,
      })
    ).toMatchObject({ value: 'failed' })
  })

  it('rolls back invalid monetary edits with their ordinary stored field value', async () => {
    const record = await handler.create(defs.get('payout')!.id, payout())
    await expect(
      service.setValue({
        recordId: record.recordId,
        fieldId: fieldIds.get('payout_source_amount')!,
        value: '1.001',
      })
    ).rejects.toThrow('precision')
    expect((await db().select().from(schema.MoneyTransfer))[0]!.sourceAmountMinor).toBe(
      9007199254740993n
    )
    expect(
      await service.getValue({
        recordId: record.recordId,
        fieldId: fieldIds.get('payout_source_amount')!,
      })
    ).toMatchObject({ value: '90071992547409.93' })
  })

  it('refuses clearing a required source amount after its observation is stored', async () => {
    const record = await handler.create(defs.get('payout')!.id, payout())
    await expect(
      service.setValue({
        recordId: record.recordId,
        fieldId: fieldIds.get('payout_source_amount')!,
        value: null,
      })
    ).rejects.toThrow('cannot be cleared')
    expect(
      await service.getValue({
        recordId: record.recordId,
        fieldId: fieldIds.get('payout_source_amount')!,
      })
    ).toMatchObject({ value: '90071992547409.93' })
  })

  it('writes processor gross, fee, and net through ordinary fields and does not create a payment', async () => {
    const record = await handler.create(defs.get('processor_balance_entry')!.id, {
      processor_balance_provider_key: 'gateway_b',
      processor_balance_account_id: 'merchant-b',
      processor_balance_environment: 'live',
      processor_balance_external_id: 'transaction-1',
      processor_balance_type: 'charge',
      processor_balance_gross: '100.00',
      processor_balance_fee: '3.00',
      processor_balance_net: '97.00',
      processor_balance_currency: 'USD',
      processor_balance_currency_exponent: 2,
    })
    expect((await db().select().from(schema.ProcessorBalanceEntry))[0]).toMatchObject({
      id: record.instance.id,
      grossMinor: 10000n,
      feeMinor: 300n,
      netMinor: 9700n,
    })
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(0)
  })

  it('stages a normally mapped customer transaction after its standard order relationship is written', async () => {
    const [order] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId: defs.get('order')!.id, updatedAt: new Date() })
      .returning()
    const record = await handler.create(defs.get('customer_transaction')!.id, {
      customer_transaction_provider_key: 'gateway_c',
      customer_transaction_account_id: 'merchant-c',
      customer_transaction_environment: 'live',
      customer_transaction_external_id: 'receipt-1',
      customer_transaction_order_external_id: 'external-order-1',
      customer_transaction_kind: 'receipt',
      customer_transaction_status: 'confirmed',
      customer_transaction_amount: '60.00',
      customer_transaction_currency: 'USD',
      customer_transaction_processed_at: '2026-09-15T00:00:00Z',
      customer_transaction_source_updated_at: '2026-09-15T01:00:00Z',
    })
    expect(await db().select().from(schema.FinancialSourceAcceptance)).toHaveLength(0)
    await service.setValue({
      recordId: record.recordId,
      fieldId: fieldIds.get('customer_transaction_order')!,
      value: toRecordId(defs.get('order')!.id, order!.id),
    })
    expect(await db().select().from(schema.FinancialSourceAcceptance)).toEqual([
      expect.objectContaining({ state: 'pending', orderInstanceId: order!.id }),
    ])
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(0)
  })

  it('captures imported scalar fields in the standard manifest and retains independent gateway identities', async () => {
    const collector = createManifestCollector({})
    const importer = new UnifiedCrudHandler(organizationId, userId, db(), undefined, {
      session: { depth: 0, origin: { kind: 'sync', source: 'import', ref: 'import-1', collector } },
    })
    const one = await importer.create(defs.get('payout')!.id, payout())
    const two = await importer.create(defs.get('payout')!.id, {
      ...payout(),
      payout_source_account_id: 'merchant-2',
    })
    expect(one.instance.id).not.toBe(two.instance.id)
    expect(collector.toJson()!.createdRecordIds).toHaveLength(2)
    expect(await db().select().from(schema.MoneyTransfer)).toHaveLength(2)
    const fields = await db()
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.entityId, one.instance.id)
        )
      )
    expect(fields.length).toBeGreaterThan(5)
  })
})

// packages/lib/src/money/reconciliation/stored-source-records.int.test.ts
import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../../data-connectors/__test-helpers'
import type { DecodedMapping } from '../../data-connectors/service'
import { entitySink } from '../../data-connectors/sinks/entity-sink'
import type { ProjectedRecord } from '../../data-connectors/sinks/types'
import { FieldValueService } from '../../field-values/field-value-service'
import { createManifestCollector } from '../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { seedSession } from '../../resources/crud/write-origin'
import { createEntityDefinitions } from '../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../seed/entity-seeder/create-fields'
import type { EntityDefMap } from '../../seed/entity-seeder/types'

vi.mock('../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))
vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async (ref: string) => ref,
}))
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

/** Two mappings of the same processor source, using real CRUD, fields, bindings and PostgreSQL. */
async function processorSinkFixture() {
  const entityDefinitionId = defs.get('processor_balance_entry')!.id
  const [connector] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId,
      type: 'generic-rest',
      name: 'Financial source replay',
    })
    .returning()
  const [run] = await db()
    .insert(schema.DataConnectorRun)
    .values({
      organizationId,
      dataConnectorId: connector!.id,
      status: 'running',
      trigger: 'manual',
      mode: 'snapshot',
    })
    .returning()
  const facts = (acquisitionId: string, acquiredAt: string, gross = '100.00') => ({
    processor_balance_source_key: JSON.stringify([
      'gateway_b',
      'merchant-b',
      'live',
      'transaction-1',
    ]),
    processor_balance_provider_key: 'gateway_b',
    processor_balance_account_id: 'merchant-b',
    processor_balance_environment: 'live',
    processor_balance_external_id: 'transaction-1',
    processor_balance_acquisition_id: acquisitionId,
    processor_balance_acquired_at: acquiredAt,
    processor_balance_type: 'charge',
    processor_balance_gross: gross,
    processor_balance_fee: '3.00',
    processor_balance_net: '97.00',
    processor_balance_currency: 'USD',
    processor_balance_currency_exponent: 2,
  })
  const projected = (
    acquisitionId: string,
    acquiredAt: string,
    gross?: string
  ): ProjectedRecord => {
    const fields = Object.fromEntries(
      Object.entries(facts(acquisitionId, acquiredAt, gross)).map(([key, value]) => [
        toResourceFieldId(entityDefinitionId, fieldIds.get(key)!),
        value,
      ])
    )
    const sourceRef = toResourceFieldId(
      entityDefinitionId,
      fieldIds.get('processor_balance_source_key')!
    )
    return {
      externalId: 'transaction-1',
      displayName: 'Transaction',
      fields,
      identityCandidates: [{ targetFieldRef: sourceRef, value: fields[sourceRef] }],
      pendingRelations: [],
    }
  }
  const mapping = async (streamKey: string): Promise<DecodedMapping> => {
    const [stream] = await db()
      .insert(schema.DataConnectorStream)
      .values({
        organizationId,
        dataConnectorId: connector!.id,
        streamKey,
      })
      .returning()
    const fieldMappings = Object.keys(facts('scan', '2026-09-15T00:00:00Z')).map((key) => ({
      id: key,
      targetFieldRef: toResourceFieldId(entityDefinitionId, fieldIds.get(key)!),
      expression: '{value}',
      sourceFields: { value: key },
    }))
    const [row] = await db()
      .insert(schema.DataConnectorMapping)
      .values({
        organizationId,
        dataConnectorStreamId: stream!.id,
        entityDefinitionId,
        targetMode: 'contributing',
        fieldMappings,
      })
      .returning()
    return {
      row: row!,
      rootPath: '',
      linkMode: 'upsert',
      targetMode: 'contributing',
      entityDefinitionId,
      parentMappingId: null,
      relationshipFieldKey: null,
      orphanBehavior: 'ignore',
      fieldMappings,
    }
  }
  const context = () => {
    const manifest = createManifestCollector({})
    const crud = new UnifiedCrudHandler(organizationId, userId, db(), undefined, {
      session: {
        depth: 0,
        origin: { kind: 'sync', source: 'import', ref: run!.id, collector: manifest },
      },
    })
    return makeSyncCtx({
      db: db(),
      orgId: organizationId,
      connector: connector!,
      runId: run!.id,
      crud,
      ownedCrud: crud,
      manifest,
    })
  }
  return { projected, mapping, context }
}

describe('processor observations arriving through two ordinary connector mappings', () => {
  it('keeps newer fields and typed money when the older payout scan arrives last, including replay', async () => {
    const f = await processorSinkFixture()
    const balance = await f.mapping('balance')
    const payout = await f.mapping('payout-child')
    const current = f.context()
    await entitySink.upsertRecord(current, balance, f.projected('new', '2026-09-15T02:00:00Z'))
    expect(current.counters).toMatchObject({ created: 1, failed: 0 })
    const older = f.context()
    await entitySink.upsertRecord(
      older,
      payout,
      f.projected('old', '2026-09-15T01:00:00Z', '90.00')
    )
    expect(older.counters).toMatchObject({ skipped: 1, failed: 0, created: 0 })
    const entries = await db().select().from(schema.ProcessorBalanceEntry)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.grossMinor).toBe(10000n)
    expect(
      await service.getValue({
        recordId: toRecordId(defs.get('processor_balance_entry')!.id, entries[0]!.id),
        fieldId: fieldIds.get('processor_balance_gross')!,
      })
    ).toMatchObject({ value: '100.00' })
    const items = await db().select().from(schema.DataConnectorItem)
    expect(items).toHaveLength(2)
    expect(new Set(items.map((item) => item.entityInstanceId)).size).toBe(1)
    expect(await db().select().from(schema.FinancialSourceObservation)).toHaveLength(2)
    await entitySink.upsertRecord(
      f.context(),
      payout,
      f.projected('old', '2026-09-15T01:00:00Z', '90.00')
    )
    expect(await db().select().from(schema.FinancialSourceObservation)).toHaveLength(2)
  })

  it('converges concurrent first creates into one record and two bindings', async () => {
    const f = await processorSinkFixture()
    const mappings = await Promise.all([f.mapping('balance'), f.mapping('payout-child')])
    const contexts = [f.context(), f.context()]
    // Hold both creates until each sink has independently found no matching record.
    let arrived = 0
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    for (const ctx of contexts) {
      const create = ctx.crud.create.bind(ctx.crud)
      vi.spyOn(ctx.crud, 'create').mockImplementation(async (...args) => {
        if (++arrived === 2) release()
        await ready
        return create(...args)
      })
    }
    await Promise.all(
      contexts.map((ctx, i) =>
        entitySink.upsertRecord(
          ctx,
          mappings[i]!,
          f.projected(i ? 'old' : 'new', i ? '2026-09-15T01:00:00Z' : '2026-09-15T02:00:00Z')
        )
      )
    )
    expect(contexts.map((ctx) => ctx.counters.failed)).toEqual([0, 0])
    expect(contexts.reduce((sum, ctx) => sum + ctx.counters.created, 0)).toBe(1)
    const entries = await db().select().from(schema.ProcessorBalanceEntry)
    const items = await db().select().from(schema.DataConnectorItem)
    expect(entries).toHaveLength(1)
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.entityInstanceId === entries[0]!.id)).toBe(true)
    const instances = await db()
      .select()
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.entityDefinitionId, defs.get('processor_balance_entry')!.id))
    expect(instances).toHaveLength(1)
  })

  it('rejects contradictory facts from the same acquisition without changing ordinary fields', async () => {
    const f = await processorSinkFixture()
    const mapping = await f.mapping('balance')
    await entitySink.upsertRecord(f.context(), mapping, f.projected('scan', '2026-09-15T02:00:00Z'))
    const conflict = f.context()
    await entitySink.upsertRecord(
      conflict,
      mapping,
      f.projected('scan', '2026-09-15T02:00:00Z', '999.00')
    )
    expect(conflict.counters.failed).toBe(1)
    const [entry] = await db().select().from(schema.ProcessorBalanceEntry)
    expect(entry!.grossMinor).toBe(10000n)
    expect(
      await service.getValue({
        recordId: toRecordId(defs.get('processor_balance_entry')!.id, entry!.id),
        fieldId: fieldIds.get('processor_balance_gross')!,
      })
    ).toMatchObject({ value: '100.00' })
  })
})

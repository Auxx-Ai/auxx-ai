// packages/lib/src/money/fulfillment-posting/__tests__/work.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFieldValueContext } from '../../../field-values/field-value-helpers'
import { FieldValueService } from '../../../field-values/field-value-service'
import { withAccountingFieldMutation } from '../../../postings/source-write-guard'
import { acceptFulfillmentWorkGroup, sweepFulfillmentAccountingWork } from '../run'

vi.mock('../../../postings/accounting-enabled', () => ({ isAccountingEnabled: async () => true }))

vi.mock('../../../cache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onCacheEvent: vi.fn(),
}))

import {
  captureFulfillmentAccountingWorkInTx,
  discoverFulfillmentAccountingWork,
  readFulfillmentAccountingSourceInTx,
} from '../work'

const db = () => getTestDb()
let organizationId: string
let userId: string
let fulfillmentId: string
let orderId: string
let orderLineId: string
let fulfillmentLineId: string
let fields: Record<string, { id: string; definitionId: string }>
let definitions: Record<string, string>

async function value(
  entityId: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
) {
  const field = fields[attribute]!
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId,
      fieldId: field.id,
      entityDefinitionId: field.definitionId,
      sortKey: 'a0',
      ...data,
    })
}
async function sealSource() {
  await value(fulfillmentId, 'fulfillment_order', { relatedEntityId: orderId })
  await value(fulfillmentId, 'fulfillment_sequence', { valueNumber: 1 })
  await value(fulfillmentId, 'fulfillment_shipped_at', { valueDate: '2026-09-10T12:00:00.000Z' })
  await value(fulfillmentId, 'fulfillment_status', { optionId: 'success' })
  await value(fulfillmentLineId, 'fulfillment_line_fulfillment', { relatedEntityId: fulfillmentId })
  await value(fulfillmentLineId, 'fulfillment_line_line_item', { relatedEntityId: orderLineId })
  await value(fulfillmentLineId, 'fulfillment_line_quantity', { valueNumber: 1 })
  await value(orderId, 'order_number', { valueText: '1001' })
  await value(orderId, 'order_channel', { optionId: 'dtc' })
  await value(orderId, 'order_currency', { valueText: 'USD' })
  await value(orderId, 'order_subtotal', { valueNumber: 100 })
  await value(orderId, 'order_tax_total', { valueNumber: 0 })
  await value(orderId, 'order_shipping_total', { valueNumber: 0 })
  await value(orderId, 'order_financial_status', { optionId: 'paid' })
  await value(orderId, 'order_payment_gateways', { valueText: 'shopify_payments' })
  await value(orderLineId, 'line_item_order', { relatedEntityId: orderId })
  await value(orderLineId, 'line_item_qty', { valueNumber: 1 })
  await value(orderLineId, 'line_item_unit_price', { valueNumber: 100 })
}
const capture = () =>
  db().transaction((tx) =>
    captureFulfillmentAccountingWorkInTx(tx, {
      organizationId,
      fulfillmentInstanceId: fulfillmentId,
    })
  )

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  fields = {}
  definitions = {}
  const attrs: Record<string, string[]> = {
    fulfillment: [
      'order',
      'sequence',
      'shipped_at',
      'status',
      'subtotal',
      'total',
      'shipping_recognised',
      'gl_posting',
    ],
    fulfillment_line: ['fulfillment', 'line_item', 'quantity'],
    order: [
      'number',
      'channel',
      'currency',
      'subtotal',
      'tax_total',
      'shipping_total',
      'financial_status',
      'payment_gateways',
    ],
    line_item: ['order', 'qty', 'unit_price'],
  }
  for (const [kind, attributes] of Object.entries(attrs)) {
    const [definition] = await db()
      .insert(schema.EntityDefinition)
      .values({ organizationId, entityType: kind, apiSlug: kind, singular: kind, plural: kind })
      .returning()
    definitions[kind] = definition!.id
    for (const attribute of attributes) {
      const key = `${kind}_${attribute}`
      const [field] = await db()
        .insert(schema.CustomField)
        .values({
          organizationId,
          entityDefinitionId: definition!.id,
          name: key,
          updatedAt: new Date(),
          type: 'TEXT',
          systemAttribute: key,
        })
        .returning()
      fields[key] = { id: field!.id, definitionId: definition!.id }
    }
  }
  const ids: Record<string, string> = {}
  for (const [kind, entityDefinitionId] of Object.entries(definitions)) {
    const [instance] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId, updatedAt: new Date() })
      .returning()
    ids[kind] = instance!.id
  }
  fulfillmentId = ids.fulfillment!
  fulfillmentLineId = ids.fulfillment_line!
  orderId = ids.order!
  orderLineId = ids.line_item!
})

describe('authoritative fulfillment source capture', () => {
  it('retains an incomplete imported header then seals a new basis after its relationships arrive', async () => {
    const first = await capture()
    expect(first.state).toBe('blocked')
    await sealSource()
    const complete = await capture()
    expect(complete.id).toBe(first.id)
    expect(complete.state).toBe('pending')
    expect(complete.basisVersion).toBe(2)
    const source = await db().transaction((tx) =>
      readFulfillmentAccountingSourceInTx(tx, organizationId, fulfillmentId)
    )
    expect(source.basis.calculation.lines[0]).toMatchObject({
      fulfillmentLineId,
      orderLineId,
      quantity: '1',
      netUnitMinor: '100',
    })
    expect(source.entry.totalDebit).toBe(100)
  })
  it('keeps exact retries on one version and appends changed pending evidence', async () => {
    await sealSource()
    const original = await capture()
    expect((await capture()).basisVersion).toBe(1)
    await db()
      .update(schema.FieldValue)
      .set({ valueNumber: 125 })
      .where(
        and(
          eq(schema.FieldValue.entityId, orderLineId),
          eq(schema.FieldValue.fieldId, fields.line_item_unit_price!.id)
        )
      )
    const updated = await capture()
    expect(updated.id).toBe(original.id)
    expect(updated.basisVersion).toBe(2)
  })
  it('preserves native receivable policy and imported paid-order clearing policy', async () => {
    await sealSource()
    const imported = await db().transaction((tx) =>
      readFulfillmentAccountingSourceInTx(tx, organizationId, fulfillmentId)
    )
    expect(imported.basis.calculation.debitRoute).toMatchObject({
      kind: 'role',
      role: 'clearing_card',
    })
    await db()
      .update(schema.EntityInstance)
      .set({ metadata: { accountingFulfillmentLane: 'native' } })
      .where(eq(schema.EntityInstance.id, fulfillmentId))
    const native = await db().transaction((tx) =>
      readFulfillmentAccountingSourceInTx(tx, organizationId, fulfillmentId)
    )
    expect(native.basis.calculation.debitRoute).toMatchObject({
      kind: 'role',
      role: 'accounts_receivable',
    })
  })
  it('blocks unresolved or foreign order-line ownership instead of posting partial connector data', async () => {
    await sealSource()
    await db()
      .delete(schema.FieldValue)
      .where(eq(schema.FieldValue.fieldId, fields.line_item_order!.id))
    const work = await capture()
    expect(work.state).toBe('blocked')
    expect(work.blockedReason).toMatch(/ownership/)
  })
  it('retains a historical posting as an explicit repair blocker', async () => {
    await sealSource()
    await value(fulfillmentId, 'fulfillment_gl_posting', { valueText: 'historical-journal' })
    const work = await capture()
    expect(work.state).toBe('blocked')
    expect(work.blockedReason).toMatch(/Historical/)
    expect(await db().select().from(schema.AccountingEffect)).toEqual([])
  })
  it('rolls a source edit and capture back together on failure', async () => {
    await sealSource()
    await expect(
      db().transaction(async (tx) => {
        await captureFulfillmentAccountingWorkInTx(tx, {
          organizationId,
          fulfillmentInstanceId: fulfillmentId,
        })
        throw new Error('crash before commit')
      })
    ).rejects.toThrow('crash before commit')
    expect(await db().select().from(schema.AccountingWork)).toEqual([])
    expect(await db().select().from(schema.AccountingWorkBasis)).toEqual([])
  })
  it('discovers committed source work without requiring a queue notification', async () => {
    await sealSource()
    const scan = await discoverFulfillmentAccountingWork(db(), { organizationId, limit: 1 })
    expect(scan.workIds).toHaveLength(1)
    expect(scan.nextCursor).toBe(fulfillmentId)
    expect(
      (
        await discoverFulfillmentAccountingWork(db(), {
          organizationId,
          afterId: scan.nextCursor!,
          limit: 1,
        })
      ).scanned
    ).toBe(0)
  })
})

async function configureAccounting() {
  await db()
    .insert(schema.OrganizationSetting)
    .values([
      { organizationId, key: 'accounting.setupState', value: 'finalized', updatedAt: new Date() },
      { organizationId, key: 'accounting.bookTimeZone', value: 'UTC', updatedAt: new Date() },
      {
        organizationId,
        key: 'accounting.fulfillmentPosting',
        value: 'auto',
        updatedAt: new Date(),
      },
    ])
  const [definition] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: 'gl_accounts',
      singular: 'Account',
      plural: 'Accounts',
      entityType: 'gl_account',
    })
    .returning()
  const accountFields = await db()
    .insert(schema.CustomField)
    .values([
      {
        organizationId,
        entityDefinitionId: definition!.id,
        name: 'Code',
        type: 'TEXT',
        systemAttribute: 'gl_account_code',
        updatedAt: new Date(),
      },
      {
        organizationId,
        entityDefinitionId: definition!.id,
        name: 'Type',
        type: 'SINGLE_SELECT',
        systemAttribute: 'gl_account_type',
        updatedAt: new Date(),
      },
    ])
    .returning()
  for (const [index, role] of [
    'clearing_card',
    'revenue_product',
    'accounts_receivable',
  ].entries()) {
    const [account] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId: definition!.id, updatedAt: new Date() })
      .returning()
    await db()
      .insert(schema.FieldValue)
      .values([
        {
          organizationId,
          entityId: account!.id,
          entityDefinitionId: definition!.id,
          fieldId: accountFields[0]!.id,
          valueText: String(1100 + index * 1000),
          sortKey: 'a0',
        },
        {
          organizationId,
          entityId: account!.id,
          entityDefinitionId: definition!.id,
          fieldId: accountFields[1]!.id,
          optionId: role === 'revenue_product' ? 'revenue' : 'asset',
          sortKey: 'a0',
        },
      ])
    await db()
      .insert(schema.GlRoleAssignment)
      .values({ organizationId, role, glAccountId: account!.id, source: 'seed' })
  }
}
function acceptSource(automatic = false) {
  return acceptFulfillmentWorkGroup(db(), {
    organizationId,
    actorUserId: userId,
    fulfillmentIds: [fulfillmentId],
    groupKey: '2026-09-10',
    automatic,
  })
}

describe('fulfillment acceptance through the domain command', () => {
  it('converges native-policy, manual and automatic commands on one original membership', async () => {
    await sealSource()
    await configureAccounting()
    await db()
      .update(schema.EntityInstance)
      .set({ metadata: { accountingFulfillmentLane: 'native' } })
      .where(eq(schema.EntityInstance.id, fulfillmentId))
    const results = await Promise.all([acceptSource(), acceptSource(true), acceptSource()])
    expect(new Set(results.map((result) => result?.glPostingId)).size).toBe(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    const work = await db().query.AccountingWork.findFirst()
    expect(work?.state).toBe('accepted')
  })
  it('rejects an amount edit through the real FieldValueService after acceptance', async () => {
    await sealSource()
    await configureAccounting()
    await acceptSource()
    const service = new FieldValueService(organizationId, userId, db())
    await expect(
      service.setValue({
        recordId: toRecordId(definitions.line_item!, orderLineId),
        fieldId: fields.line_item_unit_price!.id,
        value: 999,
      })
    ).rejects.toThrow(/accepted fulfillment accounting/)
    const price = await db().query.FieldValue.findFirst({
      where: eq(schema.FieldValue.fieldId, fields.line_item_unit_price!.id),
    })
    expect(price?.valueNumber).toBe(100)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })
  it('appends a pending basis in the same guarded transaction as a price change', async () => {
    await sealSource()
    const original = await capture()
    await db().transaction(async (tx) => {
      const ctx = createFieldValueContext(organizationId, userId, tx)
      await withAccountingFieldMutation(
        ctx,
        [
          {
            recordId: toRecordId(definitions.line_item!, orderLineId),
            fields: [{ fieldId: fields.line_item_unit_price!.id, value: 125 }],
            operation: 'set',
          },
        ],
        async (scoped) => {
          await scoped.db
            .update(schema.FieldValue)
            .set({ valueNumber: 125 })
            .where(eq(schema.FieldValue.fieldId, fields.line_item_unit_price!.id))
        }
      )
      const changed = await tx.query.AccountingWork.findFirst({
        where: eq(schema.AccountingWork.id, original.id),
      })
      expect(changed?.basisVersion).toBe(2)
    })
    expect((await capture()).basisVersion).toBe(2)
  })
  it('recovers work after a lost queue notification and honors a later manual switch', async () => {
    await sealSource()
    await configureAccounting()
    await capture()
    await db()
      .update(schema.OrganizationSetting)
      .set({ value: 'manual' })
      .where(eq(schema.OrganizationSetting.key, 'accounting.fulfillmentPosting'))
    const manual = await sweepFulfillmentAccountingWork(db(), {
      organizationId,
      actorUserId: userId,
      limit: 20,
    })
    expect(manual.accepted).toBe(0)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(0)
    await db()
      .update(schema.OrganizationSetting)
      .set({ value: 'auto' })
      .where(eq(schema.OrganizationSetting.key, 'accounting.fulfillmentPosting'))
    const recovered = await sweepFulfillmentAccountingWork(db(), {
      organizationId,
      actorUserId: userId,
      limit: 20,
    })
    expect(recovered.accepted).toBe(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })
  it('reads financial totals from accepted basis when optional UI stamps are missing', async () => {
    await sealSource()
    await configureAccounting()
    await acceptSource()
    const { readFulfillmentsForOrder } = await import('../../fulfillments/reads')
    const rows = await db().transaction((tx) =>
      readFulfillmentsForOrder(tx, { organizationId, orderId })
    )
    expect(rows[0]).toMatchObject({ subtotalMinor: 100, totalMinor: 100 })
    expect(rows[0]?.glPosting).toBeTruthy()
    const stamp = await db().query.FieldValue.findFirst({
      where: eq(schema.FieldValue.fieldId, fields.fulfillment_gl_posting!.id),
    })
    expect(stamp).toBeUndefined()
  })
  it('rejects a new child owner edge through FieldValueService after the parent was accepted', async () => {
    await sealSource()
    await configureAccounting()
    await acceptSource()
    const [child] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId,
        entityDefinitionId: definitions.fulfillment_line!,
        updatedAt: new Date(),
      })
      .returning()
    const service = new FieldValueService(organizationId, userId, db())
    await expect(
      service.setValue({
        recordId: toRecordId(definitions.fulfillment_line!, child!.id),
        fieldId: fields.fulfillment_line_fulfillment!.id,
        value: toRecordId(definitions.fulfillment!, fulfillmentId),
      })
    ).rejects.toThrow(/accepted fulfillment accounting/)
    const edge = await db().query.FieldValue.findFirst({
      where: eq(schema.FieldValue.entityId, child!.id),
    })
    expect(edge).toBeUndefined()
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })
  it('rejects append and bulk append relationship doors for a new child of an accepted fulfillment', async () => {
    await sealSource()
    await configureAccounting()
    await acceptSource()
    const [child] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId,
        entityDefinitionId: definitions.fulfillment_line!,
        updatedAt: new Date(),
      })
      .returning()
    const service = new FieldValueService(organizationId, userId, db())
    const params = {
      recordId: toRecordId(definitions.fulfillment_line!, child!.id),
      fieldId: fields.fulfillment_line_fulfillment!.id,
      relatedRecordIds: [toRecordId(definitions.fulfillment!, fulfillmentId)],
    }
    await expect(service.addRelationValues(params)).rejects.toThrow(
      /accepted fulfillment accounting/
    )
    await expect(
      service.addRelationValuesBulk({ ...params, recordIds: [params.recordId] })
    ).rejects.toThrow(/accepted fulfillment accounting/)
    expect(
      await db().query.FieldValue.findFirst({ where: eq(schema.FieldValue.entityId, child!.id) })
    ).toBeUndefined()
  })
  it('rolls back an implicit new accepted dependency discovered only after the mutation', async () => {
    await sealSource()
    await configureAccounting()
    await acceptSource()
    const [child] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId,
        entityDefinitionId: definitions.fulfillment_line!,
        updatedAt: new Date(),
      })
      .returning()
    await expect(
      db().transaction(async (tx) => {
        await withAccountingFieldMutation(
          createFieldValueContext(organizationId, userId, tx),
          [
            {
              recordId: toRecordId(definitions.fulfillment_line!, child!.id),
              operation: 'change',
              fields: [{ fieldId: fields.fulfillment_line_fulfillment!.id }],
            },
          ],
          async (scoped) => {
            await scoped.db.insert(schema.FieldValue).values({
              organizationId,
              entityDefinitionId: definitions.fulfillment_line!,
              entityId: child!.id,
              fieldId: fields.fulfillment_line_fulfillment!.id,
              relatedEntityId: fulfillmentId,
              sortKey: 'a0',
            })
          }
        )
      })
    ).rejects.toThrow(/accepted fulfillment accounting/)
    expect(
      await db().query.FieldValue.findFirst({ where: eq(schema.FieldValue.entityId, child!.id) })
    ).toBeUndefined()
  })
})

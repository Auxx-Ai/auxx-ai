// packages/lib/src/sales/credit-memos/__tests__/credit-application.int.test.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { migration164CreditApplicationHistory } from '../../../data-migrations/migrations/164-credit-application-history'
import { FieldValueService } from '../../../field-values/field-value-service'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { applyCreditMemo, unapplyCreditMemo } from '../apply'
import { runCreditCommand } from '../command'
import {
  listCreditMemoApplications,
  readContactCredit,
  readCreditMemoForRefund,
  sumCreditMemoApplications,
  sumInvoiceCreditApplications,
} from '../reads'
import { voidCreditMemo } from '../writes'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in credit database tests')
  },
}))
vi.mock('../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: vi.fn() }))
vi.mock('../../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))
const db = () => getTestDb() as unknown as Database
let organizationId: string, userId: string, memoId: string, invoiceId: string, contactId: string
let fields: Map<string, typeof schema.CustomField.$inferSelect>
let defs: EntityDefMap
async function entity(kind: string) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: defs.get(kind)!.id,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()
  return row!.id
}
async function value(
  id: string,
  attribute: string,
  data: Partial<typeof schema.FieldValue.$inferInsert>
) {
  const f = fields.get(attribute)!
  await db()
    .insert(schema.FieldValue)
    .values({
      organizationId,
      entityId: id,
      fieldId: f.id,
      entityDefinitionId: f.entityDefinitionId!,
      ...data,
    })
}
beforeEach(async () => {
  const org = await createTestOrganization()
  const user = await createTestUser()
  organizationId = org.id
  userId = user.id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: userId })
    .where(eq(schema.Organization.id, organizationId))
  const all = await createEntityDefinitions(db(), organizationId)
  defs = new Map(
    [...all].filter(([kind]) =>
      ['contact', 'invoice', 'credit_memo', 'credit_memo_application'].includes(kind)
    )
  )
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  fields = new Map(
    (
      await db()
        .select()
        .from(schema.CustomField)
        .where(eq(schema.CustomField.organizationId, organizationId))
    ).map((field) => [field.systemAttribute!, field])
  )
  contactId = await entity('contact')
  memoId = await entity('credit_memo')
  invoiceId = await entity('invoice')
  for (const [id, prefix, status] of [
    [memoId, 'credit_memo', 'issued'],
    [invoiceId, 'invoice', 'sent'],
  ] as const) {
    await value(id, `${prefix}_status`, { optionId: status })
    await value(id, `${prefix}_total`, { valueNumber: 10000 })
    await value(id, `${prefix}_balance`, { valueNumber: 10000 })
    await value(id, `${prefix}_contact`, {
      relatedEntityId: contactId,
      relatedEntityDefinitionId: defs.get('contact')!.id,
    })
  }
})
const apply = (amount: number, commandKey: string) =>
  applyCreditMemo(db(), {
    organizationId,
    userId,
    creditMemoInstanceId: memoId,
    invoiceInstanceId: invoiceId,
    amount,
    commandKey,
  })

describe('credit applications using existing entities', () => {
  it('creates the command before canonical money and replays the same saved movement', async () => {
    const execute = vi.fn(async (tx: Transaction, commandId: string) => {
      const [money] = await tx
        .insert(schema.MoneyTransaction)
        .values({
          organizationId,
          purpose: 'customer_refund',
          amountMinor: 100n,
          currency: 'USD',
          currencyExponent: 2,
          datePrecision: 'date',
          occurredOn: '2026-09-15',
          recordedByCommandId: commandId,
        })
        .returning({ id: schema.MoneyTransaction.id })
      return { moneyTransactionId: money!.id }
    })
    const input = {
      organizationId,
      userId,
      commandKey: 'canonical-refund',
      kind: 'test-canonical-refund',
      payload: { amountMinor: '100' },
    }
    const first = await runCreditCommand(db(), input, execute)
    expect(await runCreditCommand(db(), input, execute)).toEqual(first)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await db().query.MoneyTransaction.findMany()).toHaveLength(1)
  })
  it('serializes competing applications against the same balance', async () => {
    const outcomes = await Promise.allSettled([apply(7000, 'one'), apply(7000, 'two')])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await sumCreditMemoApplications(db(), organizationId, memoId)).toBe(7000)
    expect(await sumInvoiceCreditApplications(db(), organizationId, invoiceId)).toBe(7000)
  })
  it('replays the saved result and refuses a changed request using the same key', async () => {
    const first = await apply(10000, 'one')
    expect(await apply(10000, 'one')).toEqual(first)
    await expect(apply(2000, 'one')).rejects.toThrow(/different request/)
    expect(await listCreditMemoApplications(db(), organizationId, memoId)).toHaveLength(1)
  })
  it('undo retains the original and a linked reversal, restores balances and is retry safe', async () => {
    const original = await apply(3000, 'one')
    const undo = () =>
      unapplyCreditMemo(db(), {
        organizationId,
        userId,
        applicationInstanceId: original.applicationInstanceId,
      })
    await Promise.all([undo(), undo()])
    const history = await listCreditMemoApplications(db(), organizationId, memoId)
    expect(history).toHaveLength(2)
    expect(history.find((row) => row.operation === 'unapply')).toMatchObject({
      amountMinor: 3000,
      reversesApplicationId: original.applicationInstanceId,
    })
    expect(await sumCreditMemoApplications(db(), organizationId, memoId)).toBe(0)
    expect(await sumInvoiceCreditApplications(db(), organizationId, invoiceId)).toBe(0)
    expect(
      (await readContactCredit(db(), { organizationId, contactInstanceId: contactId }))
        .creditAvailableMinor
    ).toBe(10000)
  })
  it('competing refund reservations and applications cannot spend the same credit', async () => {
    const refund = () =>
      runCreditCommand(
        db(),
        {
          organizationId,
          userId,
          commandKey: 'refund',
          kind: 'test_credit_reservation',
          payload: { memoId, amount: 7000 },
        },
        async (tx) => {
          await readCreditMemoForRefund({
            organizationId,
            userId,
            creditMemoInstanceId: memoId,
            amount: 7000,
            db: tx as unknown as Database,
          })
          const [command] = await tx
            .insert(schema.MoneyCommand)
            .values({
              organizationId,
              commandKey: 'refund-money',
              kind: 'test_credit_reservation_money',
              payloadHash: 'fixture',
              actorSnapshot: {},
              resultIds: {},
            })
            .returning()
          const [money] = await tx
            .insert(schema.MoneyTransaction)
            .values({
              organizationId,
              purpose: 'customer_refund',
              amountMinor: 7000n,
              currency: 'USD',
              currencyExponent: 2,
              datePrecision: 'date',
              occurredOn: '2026-09-15',
              partyInstanceId: contactId,
              recordedByCommandId: command!.id,
            })
            .returning()
          const [row] = await tx
            .insert(schema.MoneyRefundSettlement)
            .values({
              organizationId,
              refundTransactionId: money!.id,
              amountMinor: 7000n,
              disposition: 'customer_credit',
              customerCreditMemoInstanceId: memoId,
              commandId: command!.id,
              commandItemKey: 'refund',
            })
            .returning()
          return { transactionId: row!.id }
        }
      )
    const outcomes = await Promise.allSettled([apply(7000, 'apply'), refund()])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })
  it('rolls back application records and command identity when the transaction fails', async () => {
    await expect(
      runCreditCommand(
        db(),
        { organizationId, userId, commandKey: 'rollback', kind: 'test', payload: {} },
        async (tx) => {
          await tx.insert(schema.MoneyCommand).values({
            organizationId,
            commandKey: 'rollback-proof',
            kind: 'test',
            payloadHash: 'fixture',
            actorSnapshot: {},
            resultIds: {},
          })
          throw new Error('rollback proof')
        }
      )
    ).rejects.toThrow('rollback proof')
    expect(await db().query.MoneyCommand.findMany()).toHaveLength(0)
  })
  it('rejects generic application edits and deletion', async () => {
    const original = await apply(3000, 'one')
    const recordId = toRecordId(
      defs.get('credit_memo_application')!.id,
      original.applicationInstanceId
    )
    expect(
      await new FieldValueService(organizationId, userId, db()).setValuesForEntity({
        recordId,
        values: [{ fieldId: 'credit_memo_application_amount', value: 1 }],
      })
    ).toMatchObject([{ state: 'failed', error: expect.stringMatching(/Apply credit/) }])
    await expect(
      new UnifiedCrudHandler(organizationId, userId, db()).delete(recordId)
    ).rejects.toThrow(/history cannot be deleted/)
  })
  it('counts canonical refunds before applying credit', async () => {
    const [command] = await db()
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey: 'fixture',
        kind: 'fixture',
        payloadHash: 'fixture',
        actorSnapshot: {},
        resultIds: {},
      })
      .returning()
    const [refund] = await db()
      .insert(schema.MoneyTransaction)
      .values({
        organizationId,
        purpose: 'customer_refund',
        amountMinor: 6000n,
        currency: 'USD',
        currencyExponent: 2,
        datePrecision: 'date',
        occurredOn: '2026-09-15',
        recordedByCommandId: command!.id,
      })
      .returning()
    await db().insert(schema.MoneyRefundSettlement).values({
      organizationId,
      refundTransactionId: refund!.id,
      amountMinor: 6000n,
      disposition: 'customer_credit',
      customerCreditMemoInstanceId: memoId,
      commandId: command!.id,
      commandItemKey: 'refund',
    })
    await expect(apply(5000, 'over')).rejects.toThrow(/exceeds/)
    await apply(4000, 'remaining')
    expect(await sumCreditMemoApplications(db(), organizationId, memoId)).toBe(4000)
  })
  it('serializes void against a new application', async () => {
    const outcomes = await Promise.allSettled([
      apply(3000, 'apply'),
      voidCreditMemo(db(), { organizationId, userId, creditMemoInstanceId: memoId }),
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })
  it('provisions history fields without replacing legacy applications and is repeatable', async () => {
    const legacyId = await entity('credit_memo_application')
    await value(legacyId, 'credit_memo_application_credit_memo', {
      relatedEntityId: memoId,
      relatedEntityDefinitionId: defs.get('credit_memo')!.id,
    })
    await value(legacyId, 'credit_memo_application_invoice', {
      relatedEntityId: invoiceId,
      relatedEntityDefinitionId: defs.get('invoice')!.id,
    })
    await value(legacyId, 'credit_memo_application_amount', { valueNumber: 1000 })
    await db()
      .delete(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          inArray(schema.CustomField.systemAttribute, [
            'credit_memo_application_operation',
            'credit_memo_application_reverses',
            'credit_memo_application_reversals',
          ])
        )
      )
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    const first = await migration164CreditApplicationHistory.up(db(), organizationId)
    expect(first.fieldsCreated).toBe(3)
    expect(
      (await migration164CreditApplicationHistory.up(db(), organizationId)).alreadyUpToDate
    ).toBe(true)
    expect(await sumCreditMemoApplications(db(), organizationId, memoId)).toBe(1000)
    await unapplyCreditMemo(db(), { organizationId, userId, applicationInstanceId: legacyId })
    expect(await sumCreditMemoApplications(db(), organizationId, memoId)).toBe(0)
  })

  it('refuses to void credit reserved for an in-flight refund', async () => {
    const [command] = await db()
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey: 'in-flight-refund',
        kind: 'fixture',
        payloadHash: 'fixture',
        actorSnapshot: {},
        resultIds: {},
      })
      .returning()
    const [money] = await db()
      .insert(schema.MoneyTransaction)
      .values({
        organizationId,
        purpose: 'customer_refund',
        amountMinor: 1000n,
        currency: 'USD',
        currencyExponent: 2,
        datePrecision: 'date',
        occurredOn: '2026-09-15',
        recordedByCommandId: command!.id,
      })
      .returning()
    await db().insert(schema.MoneyRefundSettlement).values({
      organizationId,
      refundTransactionId: money!.id,
      amountMinor: 1000n,
      disposition: 'customer_credit',
      customerCreditMemoInstanceId: memoId,
      commandId: command!.id,
      commandItemKey: 'refund',
    })
    await expect(
      voidCreditMemo(db(), { organizationId, userId, creditMemoInstanceId: memoId })
    ).rejects.toThrow(/pending refund/)
  })
})

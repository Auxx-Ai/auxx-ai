// packages/lib/src/money/customer-money/__tests__/refund-accounting.int.test.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { accountingBasisHash } from '../../../postings/effect-basis'
import { captureCustomerRefundWorkInTx } from '../refund-accounting'

const db = () => getTestDb() as unknown as Database

let organizationId: string
let moneyTransactionId: string

function incompleteBasis(reason: string) {
  return {
    version: 1 as const,
    status: 'incomplete' as const,
    moneyTransactionId,
    sourceHash: accountingBasisHash({ moneyTransactionId, reason }),
    effectiveDate: null,
    missingDependencies: [reason],
    observed: { moneyTransactionId, reason },
  }
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: 'refund-accounting-fixture',
      kind: 'refund-accounting-fixture',
      payloadHash: 'a'.repeat(64),
      actorSnapshot: { kind: 'test' },
    })
    .returning()
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: 'customer_refund',
      amountMinor: 150n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: '2026-09-15',
      recordedByCommandId: command!.id,
    })
    .returning()
  moneyTransactionId = money!.id
})

function capture(reason: string) {
  return db().transaction((tx) =>
    captureCustomerRefundWorkInTx(tx, {
      organizationId,
      moneyTransactionId,
      eligibility: 'manual',
      basis: incompleteBasis(reason),
    })
  )
}

describe('customer refund accounting work against PostgreSQL', () => {
  it('converges concurrent captures to one durable work item', async () => {
    const [first, second] = await Promise.all([capture('route missing'), capture('route missing')])
    expect(first.work.id).toBe(second.work.id)
    expect([first.existing, second.existing].sort()).toEqual([false, true])
    expect(await db().query.AccountingWork.findMany()).toHaveLength(1)
    expect(await db().query.AccountingWorkBasis.findMany()).toHaveLength(1)
  })

  it('appends a changed blocked basis without replacing the prior evidence', async () => {
    const first = await capture('route missing')
    const second = await capture('credit memo missing')
    expect(second.work.id).toBe(first.work.id)
    expect(second.work.basisVersion).toBe(2)
    expect(await db().query.AccountingWorkBasis.findMany()).toHaveLength(2)
    expect(
      await db()
        .select()
        .from(schema.AccountingWork)
        .where(
          and(
            eq(schema.AccountingWork.organizationId, organizationId),
            eq(schema.AccountingWork.id, first.work.id)
          )
        )
    ).toMatchObject([{ state: 'blocked', basisVersion: 2 }])
  })

  it('rolls back work and basis together when the transaction aborts', async () => {
    await expect(
      db().transaction(async (tx) => {
        await captureCustomerRefundWorkInTx(tx, {
          organizationId,
          moneyTransactionId,
          eligibility: 'manual',
          basis: incompleteBasis('route missing'),
        })
        throw new Error('simulated refund accounting crash')
      })
    ).rejects.toThrow('simulated refund accounting crash')
    expect(await db().query.AccountingWork.findMany()).toHaveLength(0)
    expect(await db().query.AccountingWorkBasis.findMany()).toHaveLength(0)
  })
})

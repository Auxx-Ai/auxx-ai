// packages/lib/src/accounting/money/bank-deposits/__tests__/eligibility.int.test.ts

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readEligibleDepositPaymentIds } from '../eligibility'
import { listUndepositedPayments } from '../reads'

vi.mock('../../../../cache', () => ({ getCachedEntityDefId: async () => undefined }))

let organizationId: string

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
})

type Fixture = {
  gateway?: string | null
  state?: 'accepted' | 'pending' | 'blocked' | 'rejected'
  environment?: 'live' | 'test'
  test?: boolean
  archived?: boolean
  date?: string
  command?: string
  paymentGatewayId?: string
}

async function receipt(id: string, options: Fixture = {}) {
  const db = getTestDb()
  const imported = 'gateway' in options
  const commandId = `cmd_${id}`
  await db.insert(schema.MoneyCommand).values({
    id: commandId,
    organizationId,
    commandKey: commandId,
    kind: options.command ?? (imported ? 'import_customer_money' : 'record_invoice_payment'),
    payloadHash: id,
    actorSnapshot: {},
  })
  const date = options.date ?? '2026-09-01'
  await db.insert(schema.MoneyTransaction).values({
    id,
    organizationId,
    recordedByCommandId: commandId,
    purpose: 'customer_receipt',
    amountMinor: 10000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: imported ? 'instant' : 'date',
    occurredOn: imported ? null : date,
    occurredAt: imported ? new Date(`${date}T12:00:00Z`) : null,
    method: imported ? null : 'check',
    paymentGatewayId: options.paymentGatewayId,
  })
  if (!imported) return id
  await db.insert(schema.FinancialSourceAccount).values({
    id: `account_${id}`,
    organizationId,
    providerKey: 'shopify',
    externalAccountId: id,
    environment: options.environment ?? 'live',
    archivedAt: options.archived ? new Date() : null,
  })
  await db.insert(schema.FinancialSourceObject).values({
    id: `source_${id}`,
    organizationId,
    sourceAccountId: `account_${id}`,
    objectType: 'order_transaction',
    externalId: id,
  })
  await db.insert(schema.FinancialSourceObservation).values({
    id: `observation_${id}`,
    organizationId,
    sourceObjectId: `source_${id}`,
    contentHash: id,
    observedAt: new Date(),
    payload: { gateway: options.gateway, test: options.test ?? false },
    reportingInstallationSnapshot: {},
  })
  await db.insert(schema.MoneySourceLink).values({
    organizationId,
    sourceObjectId: `source_${id}`,
    moneyTransactionId: id,
    verifiedByCommandId: commandId,
  })
  await db.insert(schema.FinancialSourceAcceptance).values({
    organizationId,
    sourceObjectId: `source_${id}`,
    observationId: `observation_${id}`,
    state: options.state ?? 'accepted',
    orderExternalId: `order_${id}`,
    moneyTransactionId: id,
  })
  return id
}

async function list(filters: { limit?: number; offset?: number; from?: string; to?: string } = {}) {
  return (await listUndepositedPayments(getTestDb(), { organizationId, ...filters }))
    ._unsafeUnwrap()
    .map((row) => row.paymentId)
}

describe('deposit eligibility in SQL', () => {
  it('keeps local undeposited and imported manual receipts, not processor or unknown imports', async () => {
    const ids = []
    ids.push(await receipt('local'))
    ids.push(await receipt('manual', { gateway: ' Manual ' }))
    for (const gateway of [
      'Affirm',
      'shopify_payments',
      'authorize_net',
      'paypal',
      'bogus',
      '',
      null,
    ]) {
      ids.push(await receipt(`import_${ids.length}`, { gateway }))
    }
    ids.push(await receipt('unknown_command', { command: 'unknown_writer' }))
    ids.push(await receipt('unresolved_import', { command: 'import_customer_money' }))
    expect((await list()).sort()).toEqual(['local', 'manual'])
    expect(
      [...(await readEligibleDepositPaymentIds(getTestDb(), organizationId, ids))].sort()
    ).toEqual(['local', 'manual'])
  })

  it('excludes unresolved acceptance, test sources and archived accounts', async () => {
    for (const state of ['pending', 'blocked', 'rejected'] as const) {
      await receipt(state, { gateway: 'manual', state })
    }
    await receipt('test_payment', { gateway: 'manual', test: true })
    await receipt('test_account', { gateway: 'manual', environment: 'test' })
    await receipt('archived', { gateway: 'manual', archived: true })
    expect(await list()).toEqual([])
  })

  it('uses the accepted observation rather than whichever observation arrived last', async () => {
    await receipt('processor', { gateway: 'Affirm' })
    await getTestDb()
      .insert(schema.FinancialSourceObservation)
      .values({
        organizationId,
        sourceObjectId: 'source_processor',
        contentHash: 'newer-manual',
        observedAt: new Date('2099-01-01'),
        payload: { gateway: 'manual', test: false },
        reportingInstallationSnapshot: {},
      })
    expect(await list()).toEqual([])
  })

  it('excludes conflicting sources and rechecks a changed acceptance', async () => {
    await receipt('manual', { gateway: 'manual' })
    expect(await list()).toEqual(['manual'])
    await getTestDb()
      .update(schema.FinancialSourceAcceptance)
      .set({ state: 'blocked' })
      .where(eq(schema.FinancialSourceAcceptance.moneyTransactionId, 'manual'))
    expect(await readEligibleDepositPaymentIds(getTestDb(), organizationId, ['manual'])).toEqual(
      new Set()
    )
    await receipt('second', { gateway: 'Affirm' })
    await getTestDb()
      .update(schema.MoneySourceLink)
      .set({ moneyTransactionId: 'manual' })
      .where(eq(schema.MoneySourceLink.moneyTransactionId, 'second'))
    await getTestDb()
      .update(schema.FinancialSourceAcceptance)
      .set({ state: 'accepted' })
      .where(eq(schema.FinancialSourceAcceptance.moneyTransactionId, 'manual'))
    expect(await list()).toEqual([])
  })

  it('filters before pagination and orders by payment date across pages', async () => {
    await receipt('older', { date: '2026-01-01' })
    await receipt('newest', { date: '2026-03-01', gateway: 'manual' })
    await receipt('middle', { date: '2026-02-01' })
    for (let i = 0; i < 4; i++) {
      await receipt(`processor_${i}`, { date: '2026-09-01', gateway: 'shopify_payments' })
    }
    expect(await list({ limit: 2 })).toEqual(['newest', 'middle'])
    expect(await list({ limit: 2, offset: 2 })).toEqual(['older'])
    expect(await list({ from: '2026-03-01', to: '2026-03-01' })).toEqual(['newest'])
  })

  it('does not admit receipts that acquired a gateway or belong to another organization', async () => {
    await receipt('routed', { paymentGatewayId: 'processor' })
    await receipt('other_org')
    organizationId = (await createTestOrganization()).id
    await receipt('this_org')
    expect(await list()).toEqual(['this_org'])
    expect(
      await readEligibleDepositPaymentIds(getTestDb(), organizationId, ['routed', 'other_org'])
    ).toEqual(new Set())
  })
})

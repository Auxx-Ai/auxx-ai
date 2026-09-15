// packages/lib/src/payment-gateways/settlement.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { getBankAccount } from '../banking/reads'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { financialFields } from '../money/fulfillments/field-context'
import { loadChartAccountsById } from '../postings/chart-accounts'
import { UnifiedCrudHandler } from '../resources/crud'
import { toRecordId } from '../resources/resource-id'
import { getPaymentGateway, listPaymentGateways, requirePaymentGatewayFieldContext } from './reads'
import { listSettlementSourceAccounts } from './settlement-discovery'

const attributes = [
  'payment_gateway_settlement_account',
  'payment_gateway_settlement_currency',
  'payment_gateway_settlement_bank_account',
] as const

/** Settlement selections stored as existing gateway custom fields. */
export interface GatewaySettlementFields {
  processorAccountId: string | null
  settlementCurrency: string | null
  bankAccountId: string | null
}

/** Read mapping readiness independently of importing processor evidence. */
export async function getGatewaySettlementReadiness(
  db: Database,
  input: { organizationId: string; gatewayId: string }
) {
  const gateway = await getPaymentGateway(db, input.organizationId, input.gatewayId)
  if (gateway.isErr()) throw gateway.error
  if (!gateway.value) throw new NotFoundError('Payment gateway not found')
  const selections = gateway.value
  const accounts = await listSettlementSourceAccounts(db, input.organizationId)
  const issues: string[] = []
  try {
    await validateSelections(db, input.organizationId, gateway.value, selections, accounts)
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Review settlement settings')
  }
  if (!selections.settlementCurrency) issues.push('Select a settlement currency.')
  if (!selections.bankAccountId) issues.push('Select the receiving bank account.')
  return { accounts, issues, configured: issues.length === 0 }
}

async function validateSelections(
  db: Database | Transaction,
  organizationId: string,
  gateway: { id: string; settlementSource: string },
  selections: GatewaySettlementFields,
  accounts: Awaited<ReturnType<typeof listSettlementSourceAccounts>>
) {
  const { processorAccountId, settlementCurrency, bankAccountId } = selections
  if (settlementCurrency && !/^[A-Z]{3}$/.test(settlementCurrency))
    throw new BadRequestError('Use a three-letter settlement currency.')
  if (processorAccountId) {
    const selected = accounts.find((account) => account.processorAccountId === processorAccountId)
    if (!selected)
      throw new BadRequestError(
        'Select a settlement account with imported payout or balance activity in this organization.'
      )
    if (settlementCurrency && !selected.currencies.includes(settlementCurrency))
      throw new BadRequestError(
        'The selected currency has not been reported by this settlement account.'
      )
    if (settlementCurrency) {
      const routes = await db.query.PaymentRoute.findMany({
        where: and(
          eq(schema.PaymentRoute.organizationId, organizationId),
          eq(schema.PaymentRoute.processorAccountId, processorAccountId),
          eq(schema.PaymentRoute.settlementCurrency, settlementCurrency),
          isNull(schema.PaymentRoute.archivedAt)
        ),
      })
      if (routes.some((route) => route.paymentGatewayInstanceId !== gateway.id))
        throw new ConflictError(
          'This processor account and currency use a different payment gateway. Resolve its payment route first.'
        )
    }
  }
  if (bankAccountId) {
    const result = await getBankAccount(db as Database, { organizationId, bankAccountId })
    if (result.isErr()) throw result.error
    const bank = result.value
    if (!bank || bank.archivedAt)
      throw new BadRequestError('Select an active receiving bank account.')
    if (settlementCurrency && bank.currency !== settlementCurrency)
      throw new BadRequestError('The receiving bank account must use the settlement currency.')
    if (!bank.glAccountId)
      throw new BadRequestError('Map the receiving bank account to an account in your chart first.')
    const { accounts: chart } = await loadChartAccountsById(
      db as Database,
      organizationId,
      [bank.glAccountId],
      'Configure the chart before selecting a receiving bank account.'
    )
    const mapped = chart.get(bank.glAccountId)
    if (!mapped?.isActive || mapped.accountType !== 'asset')
      throw new BadRequestError(
        'The receiving bank account needs an active asset account in your chart.'
      )
  }
}

/** Save validated custom fields with the financial command lock and a real bank relationship. */
export async function updateGatewaySettlementSettings(
  db: Database,
  input: {
    organizationId: string
    actorUserId: string
    gatewayId: string
    patch: Partial<GatewaySettlementFields>
  }
) {
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const gateway = await getPaymentGateway(tx, input.organizationId, input.gatewayId)
    if (gateway.isErr()) throw gateway.error
    if (!gateway.value) throw new NotFoundError('Payment gateway not found')
    const fields = await financialFields(input.organizationId, attributes, tx)
    const selections = gateway.value
    if (Object.values(fields).some((field) => !field))
      throw new BadRequestError(
        'Update the payment gateway fields before saving settlement settings.'
      )
    const next = { ...selections, ...input.patch }
    const accounts = await listSettlementSourceAccounts(tx, input.organizationId)
    await validateSelections(tx, input.organizationId, gateway.value, next, accounts)
    if (next.processorAccountId && next.settlementCurrency) {
      const gateways = await listPaymentGateways(tx, input.organizationId)
      if (gateways.isErr()) throw gateways.error
      const otherGateways = gateways.value.filter((other) => other.id !== input.gatewayId)
      for (const other of otherGateways) {
        const existing = other
        if (
          existing.processorAccountId === next.processorAccountId &&
          existing.settlementCurrency === next.settlementCurrency
        )
          throw new ConflictError(
            `This settlement account and currency are already assigned to ${other.name}.`
          )
      }
    }
    const bank = next.bankAccountId
      ? await getBankAccount(tx as unknown as Database, {
          organizationId: input.organizationId,
          bankAccountId: next.bankAccountId,
        })
      : null
    if (bank?.isErr()) throw bank.error
    const crud = new UnifiedCrudHandler(input.organizationId, input.actorUserId, db).withDatabase(
      tx
    )
    const ctx = await requirePaymentGatewayFieldContext(input.organizationId, tx)
    const bankRecordId = bank?.isOk() ? bank.value?.recordId : null
    await crud.update(toRecordId(ctx.paymentGatewayDefId, input.gatewayId), {
      [attributes[0]]: next.processorAccountId,
      [attributes[1]]: next.settlementCurrency,
      [attributes[2]]: bankRecordId ?? null,
    })
  })
  return getGatewaySettlementReadiness(db, input)
}

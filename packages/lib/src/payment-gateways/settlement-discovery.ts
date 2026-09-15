// packages/lib/src/payment-gateways/settlement-discovery.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { accountingBasisHash } from '../postings/effect-basis'

/** Discover explicit merchant identities with persisted settlement evidence and current source health. */
export async function listSettlementSourceAccounts(
  db: Database | Transaction,
  organizationId: string
) {
  const [entryCurrencies, payoutCurrencies] = await Promise.all([
    db
      .selectDistinct({
        accountId: schema.ProcessorBalanceEntry.sourceAccountId,
        currency: schema.ProcessorBalanceEntry.currency,
      })
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.organizationId, organizationId)),
    db
      .selectDistinct({
        accountId: schema.MoneyTransfer.sourceAccountId,
        currency: schema.MoneyTransfer.sourceCurrency,
      })
      .from(schema.MoneyTransfer)
      .where(eq(schema.MoneyTransfer.organizationId, organizationId)),
  ])
  const currenciesByAccount = new Map<string, Set<string>>()
  for (const item of [...entryCurrencies, ...payoutCurrencies]) {
    const currencies = currenciesByAccount.get(item.accountId) ?? new Set<string>()
    currencies.add(item.currency)
    currenciesByAccount.set(item.accountId, currencies)
  }
  const ids = [...currenciesByAccount.keys()]
  if (!ids.length) return []
  const observation = schema.FinancialSourceObservation
  const object = schema.FinancialSourceObject
  const account = schema.FinancialSourceAccount
  const connector = schema.DataConnector
  const credential = schema.Credential
  const installation = schema.AppInstallation
  const accounts = await db
    .select({
      processorAccountId: account.id,
      externalAccountId: account.externalAccountId,
      providerKey: account.providerKey,
      environment: account.environment,
      name: account.name,
    })
    .from(account)
    .where(
      and(
        eq(account.organizationId, organizationId),
        inArray(account.id, ids),
        eq(account.environment, 'live'),
        isNull(account.archivedAt)
      )
    )
    .orderBy(account.providerKey, account.externalAccountId, account.id)
  if (!accounts.length) return []
  const rows = await db
    .selectDistinctOn([object.sourceAccountId, connector.id], {
      processorAccountId: object.sourceAccountId,
      connectorId: connector.id,
      connectorName: connector.name,
      connectorStatus: connector.status,
      observedAt: observation.observedAt,
      requiresReauth: credential.requiresReauth,
      credentialMetadata: credential.metadata,
      reportedMetadataHash: sql<
        string | null
      >`${observation.reportingInstallationSnapshot}->>'credentialMetadataHash'`,
    })
    .from(observation)
    .innerJoin(
      object,
      and(eq(object.id, observation.sourceObjectId), eq(object.organizationId, organizationId))
    )
    .innerJoin(
      connector,
      and(
        eq(connector.id, sql<string>`${observation.reportingInstallationSnapshot}->>'connectorId'`),
        eq(connector.organizationId, organizationId)
      )
    )
    .innerJoin(
      credential,
      and(
        eq(credential.id, connector.credentialId),
        eq(credential.organizationId, organizationId),
        eq(
          credential.id,
          sql<string>`${observation.reportingInstallationSnapshot}->>'credentialId'`
        )
      )
    )
    .innerJoin(
      installation,
      and(
        eq(installation.id, connector.appInstallationId),
        eq(installation.id, credential.appInstallationId),
        eq(
          installation.id,
          sql<string>`${observation.reportingInstallationSnapshot}->>'appInstallationId'`
        ),
        eq(installation.organizationId, organizationId),
        isNull(installation.uninstalledAt)
      )
    )
    .where(
      and(
        eq(observation.organizationId, organizationId),
        inArray(
          object.sourceAccountId,
          accounts.map((item) => item.processorAccountId)
        )
      )
    )
    .orderBy(object.sourceAccountId, connector.id, desc(observation.observedAt))
  const connectionsByAccount = new Map<
    string,
    {
      connectorId: string
      connectorName: string
      connectorStatus: string
      observedAt: Date
      requiresReauth: boolean
      verified: boolean
    }[]
  >()
  for (const row of rows) {
    // An unrelated metadata edit can require fresh acquisition. Token refresh alone
    // does not invalidate the proof; no credential secrets enter this comparison.
    const verified =
      !!row.reportedMetadataHash &&
      row.reportedMetadataHash === accountingBasisHash(row.credentialMetadata)
    const connections = connectionsByAccount.get(row.processorAccountId) ?? []
    connections.push({
      connectorId: row.connectorId,
      connectorName: row.connectorName,
      connectorStatus: row.connectorStatus,
      observedAt: row.observedAt,
      requiresReauth: row.requiresReauth,
      verified,
    })
    connectionsByAccount.set(row.processorAccountId, connections)
  }
  return accounts.map((item) => ({
    ...item,
    currencies: [...currenciesByAccount.get(item.processorAccountId)!].sort(),
    connections: connectionsByAccount.get(item.processorAccountId) ?? [],
  }))
}

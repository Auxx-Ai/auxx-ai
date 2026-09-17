// packages/lib/src/payment-gateways/__tests__/settlement-discovery.int.test.ts
import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { accountingBasisHash } from '../../postings/effect-basis'
import { listUnlinkedFeeds } from '../settlement-discovery'

const db = () => getTestDb() as unknown as Database

async function source(
  organizationId: string,
  providerKey: string,
  externalAccountId: string,
  environment = 'live'
) {
  const [account] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({ organizationId, providerKey, externalAccountId, environment })
    .returning()
  return account!
}

async function activity(
  account: Awaited<ReturnType<typeof source>>,
  currency = 'USD',
  snapshot: Record<string, unknown> = {}
) {
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId: account.organizationId,
      sourceAccountId: account.id,
      objectType: 'balance_transaction',
      externalId: crypto.randomUUID(),
      componentKey: '',
    })
    .returning()
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId: account.organizationId,
      sourceObjectId: object!.id,
      contentHash: crypto.randomUUID(),
      observedAt: new Date(),
      payload: {},
      reportingInstallationSnapshot: snapshot,
    })
    .returning()
  let definition = await db().query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.organizationId, account.organizationId),
      eq(schema.EntityDefinition.entityType, 'processor_balance_entry')
    ),
  })
  if (!definition)
    [definition] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId: account.organizationId,
        entityType: 'processor_balance_entry',
        apiSlug: 'processor-activity',
        singular: 'Processor activity',
        plural: 'Processor activity',
        updatedAt: new Date(),
      })
      .returning()
  const [record] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: account.organizationId,
      entityDefinitionId: definition!.id,
      updatedAt: new Date(),
    })
    .returning()
  await db().insert(schema.ProcessorBalanceEntry).values({
    id: record!.id,
    organizationId: account.organizationId,
    sourceAccountId: account.id,
    sourceObjectId: object!.id,
    currentObservationId: observation!.id,
    externalId: object!.externalId,
    type: 'charge',
    grossMinor: 100n,
    feeMinor: 3n,
    netMinor: 97n,
    currency,
    currencyExponent: 2,
    isOutgoingTransfer: false,
  })
}

async function connection(organizationId: string) {
  const [developer] = await db()
    .insert(schema.DeveloperAccount)
    .values({ slug: crypto.randomUUID(), title: 'Fixture' })
    .returning()
  const [app] = await db()
    .insert(schema.App)
    .values({
      developerAccountId: developer!.id,
      slug: `generic-processor-${crypto.randomUUID()}`,
      title: 'Generic processor',
    })
    .returning()
  const [installation] = await db()
    .insert(schema.AppInstallation)
    .values({ organizationId, appId: app!.id, installationType: 'production' })
    .returning()
  const metadata = { merchant: 'explicit-merchant', unrelated: 'stable' }
  const [credential] = await db()
    .insert(schema.Credential)
    .values({
      organizationId,
      kind: 'app',
      appId: app!.id,
      appInstallationId: installation!.id,
      name: 'Reporting source',
      encryptedSecrets: 'fixture',
      metadata,
      updatedAt: new Date(),
    })
    .returning()
  const [connector] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId,
      type: 'app:generic-processor',
      name: 'Reporting source',
      credentialId: credential!.id,
      appInstallationId: installation!.id,
    })
    .returning()
  return {
    credential: credential!,
    connector: connector!,
    installation: installation!,
    snapshot: {
      connectorId: connector!.id,
      credentialId: credential!.id,
      appInstallationId: installation!.id,
      credentialMetadataHash: accountingBasisHash(metadata),
    },
  }
}

describe('settlement account discovery against PostgreSQL', () => {
  it('keeps explicit imported accounts separate across providers, merchants and organizations', async () => {
    const org = await createTestOrganization()
    const otherOrg = await createTestOrganization()
    const first = await source(org.id, 'processor-a', 'merchant/one')
    const second = await source(org.id, 'processor-a', 'merchant/two')
    const third = await source(org.id, 'processor-b', 'merchant/one')
    const foreign = await source(otherOrg.id, 'processor-a', 'merchant/one')
    const test = await source(org.id, 'processor-a', 'merchant/one', 'test')
    const archived = await source(org.id, 'processor-a', 'archived')
    await source(org.id, 'processor-a', 'no-activity')
    for (const account of [first, second, third, foreign, test, archived]) await activity(account)
    await activity(first, 'CAD')
    await db()
      .update(schema.FinancialSourceAccount)
      .set({ archivedAt: new Date() })
      .where(eq(schema.FinancialSourceAccount.id, archived.id))
    const result = await listUnlinkedFeeds(db(), org.id)
    expect(result.map((row) => row.processorAccountId).sort()).toEqual(
      [first.id, second.id, third.id].sort()
    )
    expect(result.find((row) => row.processorAccountId === first.id)).toMatchObject({
      currencies: ['CAD', 'USD'],
      connections: [],
    })
    expect(result.find((row) => row.processorAccountId === second.id)).toMatchObject({
      currencies: ['USD'],
      connections: [],
    })
  })

  it('retains all current reporting connections and keeps credential health separate from account mapping', async () => {
    const org = await createTestOrganization()
    const account = await source(org.id, 'processor-unrelated-to-app-slug', 'merchant/one')
    const first = await connection(org.id)
    const second = await connection(org.id)
    await activity(account, 'USD', first.snapshot)
    await activity(account, 'USD', second.snapshot)
    await db()
      .update(schema.Credential)
      .set({ requiresReauth: true })
      .where(eq(schema.Credential.id, first.credential.id))
    let [result] = await listUnlinkedFeeds(db(), org.id)
    expect(result!.connections).toHaveLength(2)
    expect(result!.connections.every((item) => item.verified)).toBe(true)
    expect(
      result!.connections.find((item) => item.connectorId === first.connector.id)?.requiresReauth
    ).toBe(true)
    await db()
      .update(schema.Credential)
      .set({ metadata: { merchant: 'changed-merchant' } })
      .where(eq(schema.Credential.id, second.credential.id))
    ;[result] = await listUnlinkedFeeds(db(), org.id)
    expect(
      result!.connections.find((item) => item.connectorId === second.connector.id)?.verified
    ).toBe(false)
    expect(result!.processorAccountId).toBe(account.id)
    await db()
      .update(schema.AppInstallation)
      .set({ uninstalledAt: new Date() })
      .where(eq(schema.AppInstallation.id, first.installation.id))
    ;[result] = await listUnlinkedFeeds(db(), org.id)
    expect(result!.connections.map((item) => item.connectorId)).toEqual([second.connector.id])
  })

  it('does not verify observations against a replacement credential or missing proof', async () => {
    const org = await createTestOrganization()
    const account = await source(org.id, 'processor-a', 'merchant/one')
    const original = await connection(org.id)
    await activity(account, 'USD', { ...original.snapshot, credentialMetadataHash: undefined })
    let [result] = await listUnlinkedFeeds(db(), org.id)
    expect(result!.connections[0]!.verified).toBe(false)
    const [replacement] = await db()
      .insert(schema.Credential)
      .values({
        organizationId: org.id,
        kind: 'app',
        appId: original.credential.appId,
        appInstallationId: original.installation.id,
        name: 'Replacement',
        encryptedSecrets: 'fixture',
        metadata: original.credential.metadata,
        updatedAt: new Date(),
      })
      .returning()
    await db()
      .update(schema.DataConnector)
      .set({ credentialId: replacement!.id })
      .where(eq(schema.DataConnector.id, original.connector.id))
    ;[result] = await listUnlinkedFeeds(db(), org.id)
    expect(result!.connections).toEqual([])
    expect(result!.processorAccountId).toBe(account.id)
  })
})

// packages/lib/src/data-connectors/__tests__/refresh-record.int.test.ts
// v13 §4 against real SQL: the record drawer's refresh resolves its binding and starts an id run.

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BoundRecordFixture, seedBoundRecord, testDb } from '../__int-test-helpers'

const seams = vi.hoisted(() => ({ enqueueConnectorSync: vi.fn(async () => {}) }))

vi.mock('../connectors/app-connector-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connectors/app-connector-adapter')>()),
  loadAppCatalogConnector: async () => ({ streams: [{ key: 'product' }] }),
}))
vi.mock('../data-connector-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data-connector-queue')>()),
  enqueueConnectorSync: seams.enqueueConnectorSync,
}))

import {
  findRecordConnectorBySource,
  findRefreshItem,
  requestRecordRefresh,
} from '../refresh-record'
import { readRecordRefresh } from '../refresh-record-status'
import { openRun } from '../service'

let f: BoundRecordFixture

async function makeApp() {
  await testDb()
    .update(schema.DataConnector)
    .set({ type: 'app:shop', definitionKind: 'app' })
    .where(eq(schema.DataConnector.id, f.connectorId))
}

/** Bind the fixture record a second time, as a fan-out child of another stream's root. */
async function bindAsChild() {
  const db = testDb()
  const [stream] = await db
    .insert(schema.DataConnectorStream)
    .values({ dataConnectorId: f.connectorId, organizationId: f.orgId, streamKey: 'order' })
    .returning()
  const [root] = await db
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: stream!.id,
      organizationId: f.orgId,
      targetMode: 'owned',
      entityDefinitionId: f.defId,
    })
    .returning()
  const [child] = await db
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: stream!.id,
      organizationId: f.orgId,
      targetMode: 'contributing',
      entityDefinitionId: f.defId,
      parentMappingId: root!.id,
      rootPath: 'line_items[]',
    })
    .returning()
  await db.insert(schema.DataConnectorItem).values({
    dataConnectorId: f.connectorId,
    organizationId: f.orgId,
    mappingId: child!.id,
    externalId: 'c9',
    entityDefinitionId: f.defId,
    entityInstanceId: f.instanceId,
    lastSyncedAt: new Date(),
  })
}

const input = () => ({
  organizationId: f.orgId,
  connectorId: f.connectorId,
  entityInstanceId: f.instanceId,
})

beforeEach(async () => {
  f = await seedBoundRecord()
  seams.enqueueConnectorSync.mockClear()
})

describe('findRefreshItem', () => {
  it('picks the root binding over a fan-out child of the same connector', async () => {
    await bindAsChild()
    const item = await findRefreshItem(testDb(), input())
    expect(item._unsafeUnwrap()).toEqual({ externalId: 'p1', streamId: f.streamId })
  })

  it('refuses a record bound only as a child, and one the connector does not bind', async () => {
    await bindAsChild()
    await testDb()
      .update(schema.DataConnectorItem)
      .set({ archivedAt: new Date() })
      .where(eq(schema.DataConnectorItem.id, f.itemId))
    const child = await findRefreshItem(testDb(), input())
    expect(child._unsafeUnwrapErr().name).toBe('UnprocessableEntityError')

    const other = await findRefreshItem(testDb(), { ...input(), connectorId: 'nope' })
    expect(other._unsafeUnwrapErr().name).toBe('NotFoundError')
  })
})

describe('requestRecordRefresh', () => {
  it('starts an id run of the record’s externalId on its root stream', async () => {
    await makeApp()
    const result = (
      await requestRecordRefresh(testDb(), { ...input(), initiatedBy: null })
    )._unsafeUnwrap()
    expect(result).toMatchObject({ status: 'started', kind: 'id', externalId: 'p1' })
    const [data, opts] = seams.enqueueConnectorSync.mock.calls[0] as unknown as [
      { reimport: { streamIds: string[]; recordFilter: unknown[]; requestId: string } },
      { jobKey: string },
    ]
    expect(data.reimport).toMatchObject({
      streamIds: [f.streamId],
      recordFilter: [{ fieldId: '$externalId', operator: 'in', value: ['p1'], exact: true }],
      requestId: result.requestId,
    })
    expect(opts.jobKey).toBe(`reimport-${result.requestId}`)
  })

  it('passes a re-import refusal through', async () => {
    const result = await requestRecordRefresh(testDb(), { ...input(), initiatedBy: null })
    expect(result._unsafeUnwrapErr().message).toMatch(/generic REST/)
    expect(seams.enqueueConnectorSync).not.toHaveBeenCalled()
  })
})

describe('findRecordConnectorBySource', () => {
  it('resolves the connector behind a source chip, on this record and connection only', async () => {
    const db = testDb()
    const [developer] = await db
      .insert(schema.DeveloperAccount)
      .values({ slug: crypto.randomUUID(), title: 'Fixture' })
      .returning()
    const [app] = await db
      .insert(schema.App)
      .values({
        developerAccountId: developer!.id,
        slug: `shop-${crypto.randomUUID()}`,
        title: 'Shop',
      })
      .returning()
    const [installation] = await db
      .insert(schema.AppInstallation)
      .values({ organizationId: f.orgId, appId: app!.id, installationType: 'production' })
      .returning()
    const [credential] = await db
      .insert(schema.Credential)
      .values({
        organizationId: f.orgId,
        kind: 'app',
        appId: app!.id,
        appInstallationId: installation!.id,
        name: 'Store',
        encryptedSecrets: 'fixture',
        updatedAt: new Date(),
      })
      .returning()
    await db
      .update(schema.DataConnector)
      .set({ appInstallationId: installation!.id, credentialId: credential!.id })
      .where(eq(schema.DataConnector.id, f.connectorId))

    const chip = {
      organizationId: f.orgId,
      entityInstanceId: f.instanceId,
      appInstallationId: installation!.id,
    }
    expect(
      (
        await findRecordConnectorBySource(db, { ...chip, connectionId: credential!.id })
      )._unsafeUnwrap()
    ).toBe(f.connectorId)
    expect(
      (await findRecordConnectorBySource(db, { ...chip, connectionId: null }))._unsafeUnwrap()
    ).toBe(f.connectorId)
    const otherConnection = await findRecordConnectorBySource(db, { ...chip, connectionId: 'x' })
    expect(otherConnection._unsafeUnwrapErr().name).toBe('NotFoundError')
  })
})

describe('readRecordRefresh', () => {
  it('waits for the run, then reads it by the request id on its progress', async () => {
    const args = { organizationId: f.orgId, connectorId: f.connectorId, requestId: 'req-1' }
    expect(await readRecordRefresh(testDb(), args)).toEqual({ state: 'waiting' })

    const run = await openRun(testDb(), {
      dataConnectorId: f.connectorId,
      organizationId: f.orgId,
      trigger: 'manual',
      mode: 'reimport',
      recordFilter: [{ fieldId: '$externalId', operator: 'in', value: ['p1'], exact: true }],
      progress: { requestId: 'req-1' },
    })
    expect(await readRecordRefresh(testDb(), args)).toEqual({ state: 'running' })

    await testDb()
      .update(schema.DataConnectorRun)
      .set({ status: 'completed', fetched: 0 })
      .where(eq(schema.DataConnectorRun.id, run.id))
    expect(await readRecordRefresh(testDb(), args)).toEqual({
      state: 'done',
      tone: 'neutral',
      message: 'Not found in Shop',
    })
    expect(await readRecordRefresh(testDb(), { ...args, requestId: 'req-2' })).toEqual({
      state: 'waiting',
    })
  })
})

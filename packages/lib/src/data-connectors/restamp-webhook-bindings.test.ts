// packages/lib/src/data-connectors/restamp-webhook-bindings.test.ts
// Re-projecting an app catalog's webhook binding onto existing connector/stream
// rows after a roll-forward (v9 §1) — manifest is source, DB rows are the
// projection. Covers stamp / preserve-unrelated-keys / remove-dropped-declaration.

import type { CatalogDataConnector } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { restampConnectorWebhookBindings } from './mutations'

const ORG = 'org_1'
const INSTALL = 'inst_1'

/**
 * Minimal drizzle chain covering the two `.query.X.findMany` + `.update().set().where()`
 * calls. `schema.DataConnector`/`schema.DataConnectorStream` don't survive object identity
 * across module instances under vitest (project memory), so updates are classified by
 * their `.set()` payload shape (`config` vs `requestConfig`) instead of the table arg.
 */
function mockDb(
  connectorRows: Array<{ id: string; config: Record<string, unknown> }>,
  streamRows: Array<{
    id: string
    streamKey: string
    requestConfig: Record<string, unknown> | null
  }>
) {
  const connectorUpdates: Array<Record<string, unknown>> = []
  const streamUpdates: Array<Record<string, unknown>> = []
  const where = vi.fn(async () => {})
  const set = vi.fn((setArgs: Record<string, unknown>) => {
    if ('config' in setArgs) connectorUpdates.push(setArgs)
    else streamUpdates.push(setArgs)
    return { where }
  })
  const update = vi.fn(() => ({ set }))
  const db = {
    query: {
      DataConnector: { findMany: vi.fn(async () => connectorRows) },
      DataConnectorStream: { findMany: vi.fn(async () => streamRows) },
    },
    update,
  }
  return { db: db as never, connectorUpdates, streamUpdates }
}

const catalogWithBinding: CatalogDataConnector = {
  id: 'shopify.core',
  label: 'Shopify Core Data',
  requiresConnection: true,
  iconKey: null,
  configJsonSchema: {},
  webhookTrigger: { triggerId: 'shopify.shopify-trigger' },
  streams: [
    {
      key: 'variant',
      displayFieldKey: 'name',
      fields: [],
      webhookTrigger: { filter: { topic: 'inventory_levels/update' }, paths: ['resourceId'] },
    },
    { key: 'orders', displayFieldKey: 'name', fields: [] },
  ],
}

describe('restampConnectorWebhookBindings', () => {
  it('stamps the connector config and matching stream requestConfig, preserving unrelated keys', async () => {
    const { db, connectorUpdates, streamUpdates } = mockDb(
      [{ id: 'dc_1', config: { filters: { foo: 'bar' } } }],
      [
        { id: 'stream_1', streamKey: 'variant', requestConfig: { someOtherKey: 'x' } },
        { id: 'stream_2', streamKey: 'orders', requestConfig: null },
      ]
    )

    await restampConnectorWebhookBindings(db, ORG, INSTALL, catalogWithBinding)

    expect(connectorUpdates).toHaveLength(1)
    expect(connectorUpdates[0]?.config).toEqual({
      filters: { foo: 'bar' },
      webhookTrigger: { triggerId: 'shopify.shopify-trigger' },
    })

    expect(streamUpdates).toHaveLength(2)
    expect(streamUpdates[0]?.requestConfig).toEqual({
      someOtherKey: 'x',
      webhookTrigger: { filter: { topic: 'inventory_levels/update' }, paths: ['resourceId'] },
    })
    // The 'orders' catalog stream declares no webhookTrigger — its row is still updated
    // (with an unchanged, empty requestConfig), not skipped: every catalog stream with a
    // matching row is visited so a dropped declaration gets removed, not just an added one.
    expect(streamUpdates[1]?.requestConfig).toEqual({})
  })

  it('removes a dropped connector-level binding while preserving other config keys', async () => {
    const { db, connectorUpdates } = mockDb(
      [
        {
          id: 'dc_1',
          config: { filters: { foo: 'bar' }, webhookTrigger: { triggerId: 'stale.trigger' } },
        },
      ],
      []
    )
    const catalogNoBinding: CatalogDataConnector = {
      ...catalogWithBinding,
      webhookTrigger: undefined,
    }

    await restampConnectorWebhookBindings(db, ORG, INSTALL, catalogNoBinding)

    expect(connectorUpdates[0]?.config).toEqual({ filters: { foo: 'bar' } })
  })

  it('removes a dropped per-stream binding while preserving other requestConfig keys', async () => {
    const { db, streamUpdates } = mockDb(
      [{ id: 'dc_1', config: {} }],
      [
        {
          id: 'stream_1',
          streamKey: 'variant',
          requestConfig: {
            someOtherKey: 'x',
            webhookTrigger: { filter: { topic: 'inventory_levels/update' }, paths: ['resourceId'] },
          },
        },
      ]
    )
    const catalogStreamDropped: CatalogDataConnector = {
      ...catalogWithBinding,
      streams: [{ key: 'variant', displayFieldKey: 'name', fields: [] }],
    }

    await restampConnectorWebhookBindings(db, ORG, INSTALL, catalogStreamDropped)

    expect(streamUpdates[0]?.requestConfig).toEqual({ someOtherKey: 'x' })
  })

  it('skips catalog streams with no matching stream row', async () => {
    const { db, streamUpdates } = mockDb([{ id: 'dc_1', config: {} }], [])

    await restampConnectorWebhookBindings(db, ORG, INSTALL, catalogWithBinding)

    expect(streamUpdates).toHaveLength(0)
  })
})

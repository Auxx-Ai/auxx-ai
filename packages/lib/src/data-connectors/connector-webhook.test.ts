// packages/lib/src/data-connectors/connector-webhook.test.ts
// Routing test for applyWebhookActions (Step 8A): an upsert action fans through the
// shared sink; a delete archives by external id; an action for an unmapped stream is
// dropped. The sink + archive are mocked so the test is pure (no DB).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyWebhookActions } from './connector-webhook'
import type { StreamWithMappings } from './service'
import type { SyncCtx } from './sinks/types'
import type { WebhookAction } from './types'

const sinkSourceRecord = vi.fn()
const archiveExternalId = vi.fn()

vi.mock('./sink-source-record', () => ({
  sinkSourceRecord: (...a: unknown[]) => sinkSourceRecord(...a),
}))
vi.mock('./reconciliation', () => ({
  archiveExternalId: (...a: unknown[]) => archiveExternalId(...a),
}))

function streamWith(streamKey: string): StreamWithMappings {
  return {
    stream: { streamKey } as StreamWithMappings['stream'],
    syncMode: 'incremental',
    mappings: [{ row: { id: `m-${streamKey}` } } as StreamWithMappings['mappings'][number]],
  }
}

const ctx = { connector: { id: 'c1' } } as unknown as SyncCtx

beforeEach(() => {
  sinkSourceRecord.mockReset()
  archiveExternalId.mockReset()
})

describe('applyWebhookActions', () => {
  it('routes an upsert through the shared sink', async () => {
    const record = { streamKey: 'orders', externalId: 'o1', fields: { total: 5 } }
    const actions: WebhookAction[] = [{ kind: 'upsert', streamKey: 'orders', record }]
    await applyWebhookActions(ctx, [streamWith('orders')], actions)

    expect(sinkSourceRecord).toHaveBeenCalledTimes(1)
    expect(sinkSourceRecord).toHaveBeenCalledWith(ctx, expect.any(Array), record)
    expect(archiveExternalId).not.toHaveBeenCalled()
  })

  it('routes a delete to archive-by-external-id', async () => {
    const actions: WebhookAction[] = [{ kind: 'delete', streamKey: 'orders', externalId: 'o9' }]
    await applyWebhookActions(ctx, [streamWith('orders')], actions)

    expect(archiveExternalId).toHaveBeenCalledTimes(1)
    expect(archiveExternalId).toHaveBeenCalledWith(ctx, expect.any(Array), 'o9')
    expect(sinkSourceRecord).not.toHaveBeenCalled()
  })

  it('drops an action whose stream is not mapped', async () => {
    const actions: WebhookAction[] = [
      { kind: 'delete', streamKey: 'unknown', externalId: 'x' },
      {
        kind: 'upsert',
        streamKey: 'orders',
        record: { streamKey: 'orders', externalId: 'o1', fields: {} },
      },
    ]
    await applyWebhookActions(ctx, [streamWith('orders')], actions)

    expect(archiveExternalId).not.toHaveBeenCalled() // unmapped delete dropped
    expect(sinkSourceRecord).toHaveBeenCalledTimes(1) // mapped upsert applied
  })
})

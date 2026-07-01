// packages/lib/src/data-connectors/update-connector-schedule-config.test.ts
// v9 §5 — updateConnector's scheduleConfig persistence rule is mode-scoped: only an
// explicit switch to 'manual' force-clears it. Switching TO webhook (or editing
// scheduleConfig while already in webhook/scheduled mode) must PRESERVE whatever
// scheduleConfig the caller passed — the old rule nulled it for anything but
// 'scheduled', which would have wiped a webhook connector's sweep cadence on every
// unrelated edit. DB is faked (mocked-db style, see adopt-shared-owned-def.test.ts).

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertJobScheduler = vi.fn()
const removeJobScheduler = vi.fn()
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({
    upsertJobScheduler: (...a: unknown[]) => upsertJobScheduler(...a),
    removeJobScheduler: (...a: unknown[]) => removeJobScheduler(...a),
  }),
  Queues: { dataConnectorQueue: 'data-connector' },
}))

import { updateConnector } from './mutations'

const PRIOR = {
  id: 'dc1',
  organizationId: 'org1',
  credentialId: null,
  config: {},
  syncBehavior: 'manual',
  status: 'live',
  scheduleConfig: null,
  lastSyncedAt: null,
}

/** Minimal drizzle chain: one transaction, one row load, one update+returning. */
function mockDb(prior: Record<string, unknown>) {
  let updateSet: Record<string, unknown> = {}
  const tx = {
    query: {
      DataConnector: { findFirst: vi.fn(async () => prior) },
    },
    update: vi.fn(() => ({
      set: (setArgs: Record<string, unknown>) => {
        updateSet = setArgs
        return {
          where: () => ({
            returning: async () => [{ ...prior, ...setArgs }],
          }),
        }
      },
    })),
  }
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  }
  return { db: db as unknown as Database, getUpdateSet: () => updateSet }
}

beforeEach(() => {
  upsertJobScheduler.mockReset()
  removeJobScheduler.mockReset()
})

describe('updateConnector scheduleConfig persistence (v9 §5)', () => {
  it('switching to webhook PRESERVES a passed scheduleConfig', async () => {
    const { db, getUpdateSet } = mockDb(PRIOR)
    await updateConnector(db, 'org1', 'dc1', {
      syncBehavior: 'webhook',
      scheduleConfig: { triggerInterval: 'off', timeBetweenTriggers: {} },
    })
    expect(getUpdateSet().scheduleConfig).toEqual({
      triggerInterval: 'off',
      timeBetweenTriggers: {},
    })
  })

  it('editing scheduleConfig alone (syncBehavior omitted) does not null it', async () => {
    const { db, getUpdateSet } = mockDb({ ...PRIOR, syncBehavior: 'webhook' })
    await updateConnector(db, 'org1', 'dc1', {
      scheduleConfig: {
        triggerInterval: 'custom',
        customCron: '0 5 * * 0',
        timeBetweenTriggers: {},
      },
    })
    expect(getUpdateSet().scheduleConfig).toEqual({
      triggerInterval: 'custom',
      customCron: '0 5 * * 0',
      timeBetweenTriggers: {},
    })
  })

  it('switching to manual force-clears scheduleConfig', async () => {
    const { db, getUpdateSet } = mockDb({ ...PRIOR, syncBehavior: 'webhook', scheduleConfig: {} })
    await updateConnector(db, 'org1', 'dc1', {
      syncBehavior: 'manual',
      scheduleConfig: {
        triggerInterval: 'custom',
        customCron: '0 5 * * 0',
        timeBetweenTriggers: {},
      },
    })
    expect(getUpdateSet().scheduleConfig).toBeNull()
  })

  it('switching to scheduled with a cadence keeps it (unchanged prior behavior)', async () => {
    const { db, getUpdateSet } = mockDb(PRIOR)
    await updateConnector(db, 'org1', 'dc1', {
      syncBehavior: 'scheduled',
      scheduleConfig: { triggerInterval: 'days', timeBetweenTriggers: { days: 1 } },
    })
    expect(getUpdateSet().scheduleConfig).toEqual({
      triggerInterval: 'days',
      timeBetweenTriggers: { days: 1 },
    })
  })
})

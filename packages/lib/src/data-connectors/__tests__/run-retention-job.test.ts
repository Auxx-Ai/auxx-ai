// packages/lib/src/data-connectors/__tests__/run-retention-job.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@auxx/database', () => ({ database: { execute: h.execute } }))

import { dataConnectorRunRetentionJob } from '../run-retention-job'

/** The SQL text of the nth `database.execute` call. */
const sqlOf = (n: number) => {
  const [query] = h.execute.mock.calls[n] as [{ queryChunks?: unknown[] }]
  return JSON.stringify(query)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.execute.mockResolvedValue({ rowCount: 0 })
})

describe('dataConnectorRunRetentionJob', () => {
  it('prunes rows, then clears aged manifests', async () => {
    await dataConnectorRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(sqlOf(0)).toContain('DELETE FROM')
    expect(sqlOf(1)).toContain('SET manifest = NULL')
  })

  it('clears manifests only on finished runs past the age cutoff', async () => {
    await dataConnectorRunRetentionJob({ data: undefined } as never)
    const clear = sqlOf(1)
    expect(clear).toContain('manifest IS NOT NULL')
    expect(clear).toContain('finishedAt')
    expect(clear).toContain('48')
  })

  it('loops the manifest clear until a pass returns fewer than the batch size', async () => {
    h.execute
      .mockResolvedValueOnce({ rowCount: 0 }) // the prune
      .mockResolvedValueOnce({ rowCount: 500 })
      .mockResolvedValueOnce({ rowCount: 500 })
      .mockResolvedValueOnce({ rowCount: 7 })
    await dataConnectorRunRetentionJob({ data: undefined } as never)
    expect(h.execute).toHaveBeenCalledTimes(4)
  })

  it('honors a manifestHours override', async () => {
    await dataConnectorRunRetentionJob({ data: { manifestHours: 6 } } as never)
    expect(sqlOf(1)).toContain('6')
  })
})

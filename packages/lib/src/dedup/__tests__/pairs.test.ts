// packages/lib/src/dedup/__tests__/pairs.test.ts
//
// The write path's SHAPE: the conflict target, the merged-row guard, the
// band-upgrade arm, and canonical-order enforcement.
//
// Hand-rolled `db` — these functions take `db` first, so nothing here needs the
// database module replaced (the shared `src/test/setup.ts` proxy stays in place,
// per the lib-test rule about never fully replacing `@auxx/database`).
//
// A fake db is predicate-BLIND: it cannot prove the unique index actually
// collapses (A,B)/(B,A), nor that a `setWhere` really spares a merged row. Those
// claims are pinned in `dedup-engine.int.test.ts` against real SQL.

import { describe, expect, it, vi } from 'vitest'
import { rescoreOpenPairsForRecord, resolveSuggestionsForMerge, upsertPairs } from '../pairs'
import type { ScoredPair } from '../scoring'

const pair = (overrides: Partial<ScoredPair> = {}): ScoredPair => ({
  organizationId: 'org_1',
  entityDefinitionId: 'def_1',
  instanceIdLow: 'aaa',
  instanceIdHigh: 'bbb',
  score: 0.9,
  band: 'high',
  signals: [{ type: 'email', strength: 'strong', value: 'a@x.com', fieldKey: 'primaryEmail' }],
  ...overrides,
})

function insertDb(returned: unknown[] = [{ id: 'dup_1' }]) {
  const configs: Record<string, unknown>[] = []
  const values: Record<string, unknown>[] = []
  const chain = {
    values: vi.fn((v: Record<string, unknown>) => {
      values.push(v)
      return chain
    }),
    onConflictDoUpdate: vi.fn((config: Record<string, unknown>) => {
      configs.push(config)
      return chain
    }),
    returning: vi.fn(async () => returned),
  }
  return { db: { insert: vi.fn(() => chain) } as never, chain, configs, values }
}

describe('upsertPairs — canonical ordering is enforced by the WRITER', () => {
  it('rejects a pair that is not in canonical order', async () => {
    // Sorting silently would hide the bug; the canonical order is the only reason
    // (A,B) and (B,A) collapse onto one row.
    const { db } = insertDb()
    const result = await upsertPairs(db, [pair({ instanceIdLow: 'zzz', instanceIdHigh: 'aaa' })])
    expect(result._unsafeUnwrapErr().message).toMatch(/canonical order/i)
  })

  it('rejects a record paired with itself', async () => {
    const { db } = insertDb()
    const result = await upsertPairs(db, [pair({ instanceIdLow: 'aaa', instanceIdHigh: 'aaa' })])
    expect(result._unsafeUnwrapErr().message).toMatch(/own duplicate/i)
  })

  it('conflicts on the full four-column pair key', async () => {
    const { db, configs } = insertDb()
    await upsertPairs(db, [pair()])
    expect((configs[0]?.target as unknown[]).length).toBe(4)
  })

  it('guards the UPDATE so a merged row is never resurrected', async () => {
    // Merge is terminal. Without setWhere a re-scan would ask the user to merge
    // records they already merged.
    const { db, configs } = insertDb()
    await upsertPairs(db, [pair()])
    expect(configs[0]?.setWhere).toBeDefined()
  })

  it('refreshes score, band and signals on every rescan', async () => {
    const { db, configs } = insertDb()
    await upsertPairs(db, [pair()])
    const set = configs[0]?.set as Record<string, unknown>
    expect(Object.keys(set)).toEqual(
      expect.arrayContaining(['score', 'band', 'signals', 'updatedAt'])
    )
  })

  it('carries the reopen arm only when the new band is high', async () => {
    const { db, configs } = insertDb()
    await upsertPairs(db, [pair({ band: 'high' })])
    const highSet = configs[0]?.set as Record<string, unknown>
    expect(highSet).toHaveProperty('status')
    expect(highSet).toHaveProperty('snoozeUntil')

    const { db: db2, configs: configs2 } = insertDb()
    await upsertPairs(db2, [pair({ band: 'medium', score: 0.5 })])
    const mediumSet = configs2[0]?.set as Record<string, unknown>
    // `medium` is the lowest stored band, so a medium rescan can never be an
    // upgrade — it must not disturb a dismissal or a snooze.
    expect(mediumSet).not.toHaveProperty('status')
    expect(mediumSet).not.toHaveProperty('snoozeUntil')
  })

  it('collapses a batch that contains the same pair twice', async () => {
    // Two identical rows in ONE statement would trip "ON CONFLICT DO UPDATE
    // command cannot affect row a second time"; per-row upserts plus this dedupe
    // keep the scan idempotent no matter how many doors enqueued it.
    const { db, chain } = insertDb()
    const result = await upsertPairs(db, [pair(), pair()])
    expect(result._unsafeUnwrap()).toBe(1)
    expect(chain.values).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for an empty set', async () => {
    const { db } = insertDb()
    const result = await upsertPairs(db, [])
    expect(result._unsafeUnwrap()).toBe(0)
  })

  it('counts a row skipped by setWhere as not written', async () => {
    const { db } = insertDb([])
    expect((await upsertPairs(db, [pair()]))._unsafeUnwrap()).toBe(0)
  })
})

describe('rescoreOpenPairsForRecord — rescore-on-change is mandatory', () => {
  function deleteDb(returned: unknown[]) {
    const where = vi.fn(() => ({ returning: async () => returned }))
    const db = { delete: vi.fn(() => ({ where })) } as never
    return { db, where }
  }

  it('closes the open pairs the fresh scan no longer supports', async () => {
    const { db, where } = deleteDb([{ id: 'a' }, { id: 'b' }])
    const result = await rescoreOpenPairsForRecord(db, {
      organizationId: 'org_1',
      entityDefinitionId: 'def_1',
      instanceId: 'aaa',
      pairs: [pair()],
    })
    expect(result._unsafeUnwrap()).toBe(2)
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('closes every open pair when the record no longer matches anything', async () => {
    // A corrected email leaves its duplicate suggestion standing forever without
    // this arm — the store would be upsert-only.
    const { db } = deleteDb([{ id: 'a' }])
    const result = await rescoreOpenPairsForRecord(db, {
      organizationId: 'org_1',
      entityDefinitionId: 'def_1',
      instanceId: 'aaa',
      pairs: [],
    })
    expect(result._unsafeUnwrap()).toBe(1)
  })

  it('ignores pairs in the fresh set that do not touch this record', async () => {
    const { db } = deleteDb([])
    const result = await rescoreOpenPairsForRecord(db, {
      organizationId: 'org_1',
      entityDefinitionId: 'def_1',
      instanceId: 'aaa',
      pairs: [pair({ instanceIdLow: 'ccc', instanceIdHigh: 'ddd' })],
    })
    expect(result.isOk()).toBe(true)
  })
})

describe('resolveSuggestionsForMerge — runs INSIDE the merge transaction', () => {
  function txMock(merged: unknown[], closed: unknown[]) {
    const set = vi.fn((_values: Record<string, unknown>) => ({
      where: () => ({ returning: async () => merged }),
    }))
    const tx = {
      update: vi.fn(() => ({ set })),
      delete: vi.fn(() => ({ where: () => ({ returning: async () => closed }) })),
    } as never
    return { tx, set }
  }

  it('stamps the acted-on pair merged and closes the source’s other pairs', async () => {
    const { tx, set } = txMock([{ id: 'p1' }], [{ id: 'p2' }, { id: 'p3' }])
    const result = await resolveSuggestionsForMerge(tx, 'org_1', 'aaa', ['bbb'])
    expect(result._unsafeUnwrap()).toEqual({ merged: 1, closed: 2 })
    expect(set.mock.calls[0]?.[0]).toMatchObject({ status: 'merged' })
  })

  it('is a no-op with no sources', async () => {
    const { tx } = txMock([], [])
    const result = await resolveSuggestionsForMerge(tx, 'org_1', 'aaa', [])
    expect(result._unsafeUnwrap()).toEqual({ merged: 0, closed: 0 })
  })
})

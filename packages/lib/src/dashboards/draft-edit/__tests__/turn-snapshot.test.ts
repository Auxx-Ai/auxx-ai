// packages/lib/src/dashboards/draft-edit/__tests__/turn-snapshot.test.ts
//
// The pre-turn slot. Capture is idempotent WITHIN a turn (or whole-turn Undo
// degrades to undo-the-last-edit) and overwrites ACROSS turns; every read and
// write is turn-checked, so a superseded turn can neither read, relabel nor
// delete a fresher turn's snapshot.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisStore = new Map<string, unknown>()
// Partial mock: the barrel is imported by other lib modules (credential-lock),
// so replacing it wholesale dies at collection. Only the data helpers the slot
// uses are stubbed.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisData: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  setRedisData: vi.fn(async (key: string, data: unknown) => {
    redisStore.set(key, data)
    return 'OK'
  }),
  deleteRedisData: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
}))

import {
  captureDashboardTurnSnapshot,
  clearDashboardTurnSnapshot,
  finalizeDashboardTurn,
  readDashboardTurnSnapshot,
  recordDashboardTurnEnding,
  recordDashboardTurnPostHash,
} from '../turn-snapshot'
import { doc, tab, widget } from './support/fixtures'

const DASH = 'dash_1'
const TURN_A = 'turn_a'
const TURN_B = 'turn_b'
const KEY = `dashboard:layout:${DASH}:preturn`

const docA = doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])])
const docB = doc([tab('tab_1', 'Overview', [widget('w2', 'Other')])])

beforeEach(() => {
  redisStore.clear()
})

describe('capture', () => {
  it('stores the pre-edit doc under this turn', async () => {
    expect(await captureDashboardTurnSnapshot(DASH, TURN_A, docA)).toBe(true)
    expect(redisStore.has(KEY)).toBe(true)
    expect((await readDashboardTurnSnapshot(DASH))?.doc).toEqual(docA)
  })

  // THE property: the second write of a turn must not bump the snapshot.
  it('is idempotent within a turn', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    expect(await captureDashboardTurnSnapshot(DASH, TURN_A, docB)).toBe(false)
    expect((await readDashboardTurnSnapshot(DASH))?.doc).toEqual(docA)
  })

  it('overwrites across turns: a new turn supersedes the old one', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    expect(await captureDashboardTurnSnapshot(DASH, TURN_B, docB)).toBe(true)
    expect((await readDashboardTurnSnapshot(DASH))?.turnId).toBe(TURN_B)
  })
})

describe('read is turn-checked', () => {
  it('returns null for a foreign turn id, which is how a stale caller learns it lost', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_B, docB)
    expect(await readDashboardTurnSnapshot(DASH, TURN_A)).toBeNull()
    expect(await readDashboardTurnSnapshot(DASH, TURN_B)).not.toBeNull()
  })

  // "This turn never wrote" and "a newer turn took the slot" are deliberately
  // indistinguishable: neither has anything to recover.
  it('returns null when nothing was ever captured', async () => {
    expect(await readDashboardTurnSnapshot(DASH, TURN_A)).toBeNull()
  })
})

describe('recordDashboardTurnPostHash', () => {
  it('stamps the hash of what the turn just wrote, last write winning', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    await recordDashboardTurnPostHash(DASH, TURN_A, 'hash-1')
    await recordDashboardTurnPostHash(DASH, TURN_A, 'hash-2')
    expect((await readDashboardTurnSnapshot(DASH))?.postTurnLayoutHash).toBe('hash-2')
  })

  it('ignores an empty hash rather than clearing the stamp', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    await recordDashboardTurnPostHash(DASH, TURN_A, 'hash-1')
    await recordDashboardTurnPostHash(DASH, TURN_A, null)
    expect((await readDashboardTurnSnapshot(DASH))?.postTurnLayoutHash).toBe('hash-1')
  })

  it('is turn-checked: a stale turn cannot re-stamp a fresher snapshot', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_B, docB)
    await recordDashboardTurnPostHash(DASH, TURN_A, 'stale')
    expect((await readDashboardTurnSnapshot(DASH))?.postTurnLayoutHash).toBeUndefined()
  })
})

describe('recordDashboardTurnEnding', () => {
  it('is ADDITIVE: the snapshot and its doc survive the label', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    await recordDashboardTurnEnding(DASH, TURN_A, 'aborted')
    const snapshot = await readDashboardTurnSnapshot(DASH, TURN_A)
    expect(snapshot?.endedAs).toBe('aborted')
    expect(snapshot?.doc).toEqual(docA)
  })

  it('is turn-checked: a stale turn cannot relabel a fresher snapshot', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_B, docB)
    await recordDashboardTurnEnding(DASH, TURN_A, 'error')
    expect((await readDashboardTurnSnapshot(DASH))?.endedAs).toBeUndefined()
  })
})

describe('finalize and clear', () => {
  it('finalize discards this turn snapshot', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_A, docA)
    await finalizeDashboardTurn(DASH, TURN_A)
    expect(redisStore.has(KEY)).toBe(false)
  })

  it('finalize is turn-checked: a stale turn end cannot discard a live snapshot', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_B, docB)
    await finalizeDashboardTurn(DASH, TURN_A)
    expect((await readDashboardTurnSnapshot(DASH))?.turnId).toBe(TURN_B)
  })

  // The non-agent write path saying "the dashboard moved under you", so a late
  // revert can never roll back over edits made by hand.
  it('clear deletes unconditionally, with no turn check', async () => {
    await captureDashboardTurnSnapshot(DASH, TURN_B, docB)
    await clearDashboardTurnSnapshot(DASH)
    expect(redisStore.has(KEY)).toBe(false)
  })
})

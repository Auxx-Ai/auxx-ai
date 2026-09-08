// packages/lib/src/dashboards/draft-edit/__tests__/turn-lock.test.ts
//
// The canvas edit lock. Two properties carry the whole design: the acquire is
// an EDGE (only the first tool call of a turn announces a start), and the
// release is TURN-CHECKED (a stale turn can never unlock the canvas, and
// resume its auto-save, under a live one). Everything else fails open.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisSet = vi.fn()
const getRedisData = vi.fn()
const deleteRedisData = vi.fn()
const getRedisClient = vi.fn()

vi.mock('@auxx/redis', () => ({
  getRedisClient: (...a: unknown[]) => getRedisClient(...a),
  getRedisData: (...a: unknown[]) => getRedisData(...a),
  deleteRedisData: (...a: unknown[]) => deleteRedisData(...a),
  setRedisData: vi.fn(),
}))

const publishDashboardKopilotTurn = vi.fn()
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ tag: 'realtime' }),
  publishDashboardKopilotTurn: (...a: unknown[]) => publishDashboardKopilotTurn(...a),
}))

import {
  acquireDashboardTurnLock,
  beginDashboardTurnLock,
  endDashboardTurnLock,
  readDashboardTurnLock,
  releaseDashboardTurnLock,
} from '../turn-lock'

const ORG = 'org_1'
const DASH = 'dash_1'
const TURN = 'turn_1'
const KEY = `dashboard:kopilot:turn:${DASH}`

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue('OK')
  getRedisClient.mockReset().mockResolvedValue({ set: redisSet })
  getRedisData.mockReset().mockResolvedValue(null)
  deleteRedisData.mockReset().mockResolvedValue(undefined)
  publishDashboardKopilotTurn.mockReset().mockResolvedValue(undefined)
})

describe('acquireDashboardTurnLock', () => {
  it('claims atomically with SET NX EX, never a read-then-write race', async () => {
    await acquireDashboardTurnLock(DASH, TURN)
    const [key, , ex, ttl, nx] = redisSet.mock.calls[0] as unknown[]
    expect(key).toBe(KEY)
    expect(ex).toBe('EX')
    expect(ttl).toBe(15 * 60)
    expect(nx).toBe('NX')
  })

  it('returns true only on the transition: a held key does not re-announce', async () => {
    expect(await acquireDashboardTurnLock(DASH, TURN)).toBe(true)
    redisSet.mockResolvedValue(null)
    expect(await acquireDashboardTurnLock(DASH, TURN)).toBe(false)
  })

  // A stranded read-only canvas recoverable only by reload is a worse failure
  // than the race; the hash-CAS is the real correctness guard underneath.
  it('fails OPEN when Redis is unavailable', async () => {
    getRedisClient.mockResolvedValue(undefined)
    expect(await acquireDashboardTurnLock(DASH, TURN)).toBe(false)
  })

  it('fails OPEN when Redis throws', async () => {
    getRedisClient.mockRejectedValue(new Error('down'))
    expect(await acquireDashboardTurnLock(DASH, TURN)).toBe(false)
  })
})

describe('releaseDashboardTurnLock', () => {
  it('releases when the slot belongs to this turn', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    expect(await releaseDashboardTurnLock(DASH, TURN)).toBe(true)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
  })

  it('refuses to release a DIFFERENT turn lock', async () => {
    getRedisData.mockResolvedValue({ turnId: 'turn_2', startedAt: 1 })
    expect(await releaseDashboardTurnLock(DASH, TURN)).toBe(false)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('nothing held means nothing released and nothing thrown', async () => {
    expect(await releaseDashboardTurnLock(DASH, TURN)).toBe(false)
  })
})

describe('readDashboardTurnLock', () => {
  it('returns the open turn, which is what a reconnecting client re-derives from', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 7 })
    expect(await readDashboardTurnLock(DASH)).toEqual({ turnId: TURN, startedAt: 7 })
  })

  it('reads as "no turn open" when Redis throws', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    expect(await readDashboardTurnLock(DASH)).toBeNull()
  })
})

describe('begin/end publish exactly on the transition', () => {
  it('begin announces started once, and not again inside the same turn', async () => {
    await beginDashboardTurnLock(ORG, DASH, TURN)
    expect(publishDashboardKopilotTurn).toHaveBeenCalledWith(expect.anything(), ORG, {
      dashboardId: DASH,
      turnId: TURN,
      phase: 'started',
    })

    redisSet.mockResolvedValue(null)
    await beginDashboardTurnLock(ORG, DASH, TURN)
    expect(publishDashboardKopilotTurn).toHaveBeenCalledTimes(1)
  })

  it('end announces ended only when this turn actually held the lock', async () => {
    getRedisData.mockResolvedValue({ turnId: 'turn_2', startedAt: 1 })
    await endDashboardTurnLock(ORG, DASH, TURN)
    expect(publishDashboardKopilotTurn).not.toHaveBeenCalled()

    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    await endDashboardTurnLock(ORG, DASH, TURN)
    expect(publishDashboardKopilotTurn).toHaveBeenCalledWith(expect.anything(), ORG, {
      dashboardId: DASH,
      turnId: TURN,
      phase: 'ended',
    })
  })

  it('a realtime failure never propagates: the publish is fire-and-forget', async () => {
    publishDashboardKopilotTurn.mockRejectedValue(new Error('pusher down'))
    await expect(beginDashboardTurnLock(ORG, DASH, TURN)).resolves.toBeUndefined()
  })
})

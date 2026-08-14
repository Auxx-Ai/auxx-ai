// packages/lib/src/workflows/graph-edit/__tests__/turn-lock.test.ts
//
// The canvas edit lock (plan 14 §6.7). Two properties carry the whole design:
// the acquire is an EDGE (only the first tool call of a turn announces a
// start), and the release is TURN-CHECKED (a stale turn can never unlock the
// canvas under a live one). Everything else fails open.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisSet = vi.fn()
const getRedisData = vi.fn()
const deleteRedisData = vi.fn()
const getRedisClient = vi.fn()

vi.mock('@auxx/redis', () => ({
  getRedisClient: (...a: unknown[]) => getRedisClient(...a),
  getRedisData: (...a: unknown[]) => getRedisData(...a),
  deleteRedisData: (...a: unknown[]) => deleteRedisData(...a),
}))

const publishWorkflowKopilotTurn = vi.fn()
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ tag: 'realtime' }),
  publishWorkflowKopilotTurn: (...a: unknown[]) => publishWorkflowKopilotTurn(...a),
}))

import {
  acquireWorkflowTurnLock,
  beginWorkflowTurnLock,
  endWorkflowTurnLock,
  readWorkflowTurnLock,
  releaseWorkflowTurnLock,
} from '../turn-lock'

const ORG = 'org-1'
const WF = 'wfapp-1'
const TURN = 'turn-1'
const KEY = `workflow:kopilot:turn:${WF}`

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue('OK')
  getRedisClient.mockReset().mockResolvedValue({ set: redisSet })
  getRedisData.mockReset().mockResolvedValue(null)
  deleteRedisData.mockReset().mockResolvedValue(undefined)
  publishWorkflowKopilotTurn.mockReset().mockResolvedValue(undefined)
})

describe('acquireWorkflowTurnLock', () => {
  it('claims atomically with SET NX EX — never a read-then-write race', async () => {
    await acquireWorkflowTurnLock(WF, TURN)
    expect(redisSet).toHaveBeenCalledTimes(1)
    const [key, , ex, ttl, nx] = redisSet.mock.calls[0] as unknown[]
    expect(key).toBe(KEY)
    expect(ex).toBe('EX')
    expect(typeof ttl).toBe('number')
    expect(nx).toBe('NX')
  })

  it('returns true only on the transition — a held key does not re-announce', async () => {
    expect(await acquireWorkflowTurnLock(WF, TURN)).toBe(true)
    redisSet.mockResolvedValue(null) // NX refused: someone holds it
    expect(await acquireWorkflowTurnLock(WF, TURN)).toBe(false)
  })

  it('fails OPEN when Redis is unavailable — the canvas stays editable', async () => {
    getRedisClient.mockResolvedValue(undefined)
    expect(await acquireWorkflowTurnLock(WF, TURN)).toBe(false)
  })

  it('fails OPEN when Redis throws', async () => {
    getRedisClient.mockRejectedValue(new Error('down'))
    expect(await acquireWorkflowTurnLock(WF, TURN)).toBe(false)
  })
})

describe('releaseWorkflowTurnLock', () => {
  it('releases when the slot belongs to this turn', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    expect(await releaseWorkflowTurnLock(WF, TURN)).toBe(true)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
  })

  // THE safety property: a superseded turn's late `onTurnEnd` must not unlock
  // the canvas while a fresher turn is still writing to the draft.
  it('refuses to release a DIFFERENT turn’s lock', async () => {
    getRedisData.mockResolvedValue({ turnId: 'turn-2', startedAt: 1 })
    expect(await releaseWorkflowTurnLock(WF, TURN)).toBe(false)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('no lock held ⇒ nothing released, nothing thrown', async () => {
    getRedisData.mockResolvedValue(null)
    expect(await releaseWorkflowTurnLock(WF, TURN)).toBe(false)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })
})

describe('readWorkflowTurnLock', () => {
  it('returns the open turn — this is what a reconnecting client re-derives from', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    expect(await readWorkflowTurnLock(WF)).toEqual({ turnId: TURN, startedAt: 1 })
  })

  it('reads as "no turn open" when Redis throws — fails open', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    expect(await readWorkflowTurnLock(WF)).toBeNull()
  })
})

describe('begin/end publish exactly on the transition', () => {
  it('begin announces `started` once, and not again inside the same turn', async () => {
    await beginWorkflowTurnLock(ORG, WF, TURN)
    expect(publishWorkflowKopilotTurn).toHaveBeenCalledTimes(1)
    expect(publishWorkflowKopilotTurn).toHaveBeenCalledWith(expect.anything(), ORG, {
      workflowAppId: WF,
      turnId: TURN,
      phase: 'started',
    })

    // Every later tool call of the same turn: NX refuses, so no re-announce.
    redisSet.mockResolvedValue(null)
    await beginWorkflowTurnLock(ORG, WF, TURN)
    expect(publishWorkflowKopilotTurn).toHaveBeenCalledTimes(1)
  })

  it('end announces `ended` only when this turn actually held the lock', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    await endWorkflowTurnLock(ORG, WF, TURN)
    expect(publishWorkflowKopilotTurn).toHaveBeenCalledWith(expect.anything(), ORG, {
      workflowAppId: WF,
      turnId: TURN,
      phase: 'ended',
    })
  })

  it('a superseded turn ending publishes NOTHING — no phantom unlock', async () => {
    getRedisData.mockResolvedValue({ turnId: 'turn-2', startedAt: 1 })
    await endWorkflowTurnLock(ORG, WF, TURN)
    expect(publishWorkflowKopilotTurn).not.toHaveBeenCalled()
  })

  it('a failed publish never throws — the lock write already happened', async () => {
    publishWorkflowKopilotTurn.mockRejectedValue(new Error('pusher down'))
    await expect(beginWorkflowTurnLock(ORG, WF, TURN)).resolves.toBeUndefined()
  })
})

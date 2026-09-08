// packages/lib/src/turn-scoped/__tests__/turn-lock.test.ts
//
// The three invariants named in `turn-lock.ts`: the acquire is ATOMIC and an
// EDGE (only the transition returns true), the release is TURN-CHECKED (a stale
// turn can never unlock a subject under a live one), and everything FAILS OPEN.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisSet = vi.fn()
const getRedisClient = vi.fn()
const getRedisData = vi.fn()
const deleteRedisData = vi.fn()

vi.mock('@auxx/redis', () => ({
  getRedisClient: (...a: unknown[]) => getRedisClient(...a),
  getRedisData: (...a: unknown[]) => getRedisData(...a),
  deleteRedisData: (...a: unknown[]) => deleteRedisData(...a),
}))

import { createTurnLock } from '../turn-lock'

const SUBJECT = 'subject-1'
const TURN = 'turn-1'
const OTHER = 'turn-2'
const KEY = `test:turn:${SUBJECT}`
const TTL = 900

const lock = createTurnLock({
  key: (id) => `test:turn:${id}`,
  ttlSeconds: TTL,
  logScope: 'turn-lock-test',
})

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue('OK')
  getRedisClient.mockReset().mockResolvedValue({ set: redisSet })
  getRedisData.mockReset().mockResolvedValue(null)
  deleteRedisData.mockReset().mockResolvedValue(1)
})

describe('acquire (invariant 1: atomic and edge-triggered)', () => {
  it('claims with a single SET NX EX — never a read-then-write race', async () => {
    await lock.acquire(SUBJECT, TURN)

    expect(redisSet).toHaveBeenCalledTimes(1)
    // Argument ORDER is the contract: ioredis reads the option tokens
    // positionally, so `EX ttl NX` transposed is a different command.
    const [key, value, ex, ttl, nx] = redisSet.mock.calls[0] as unknown[]
    expect(key).toBe(KEY)
    expect(ex).toBe('EX')
    expect(ttl).toBe(TTL)
    expect(nx).toBe('NX')
    // No read preceded it.
    expect(getRedisData).not.toHaveBeenCalled()

    const record = JSON.parse(value as string) as { turnId: string; startedAt: number }
    expect(record.turnId).toBe(TURN)
    expect(typeof record.startedAt).toBe('number')
  })

  it('returns true only on the transition — a held key does not re-announce', async () => {
    expect(await lock.acquire(SUBJECT, TURN)).toBe(true)
    redisSet.mockResolvedValue(null) // NX refused: someone holds it
    expect(await lock.acquire(SUBJECT, TURN)).toBe(false)
  })

  it('uses the configured key builder, so two subjects never share a slot', async () => {
    await lock.acquire('subject-2', TURN)
    expect(redisSet.mock.calls[0]?.[0]).toBe('test:turn:subject-2')
  })

  it('fails OPEN when there is no Redis client — the subject stays editable', async () => {
    getRedisClient.mockResolvedValue(undefined)
    expect(await lock.acquire(SUBJECT, TURN)).toBe(false)
    expect(redisSet).not.toHaveBeenCalled()
  })

  it('fails OPEN when Redis throws', async () => {
    getRedisClient.mockRejectedValue(new Error('down'))
    expect(await lock.acquire(SUBJECT, TURN)).toBe(false)
  })
})

describe('read', () => {
  it('returns the open turn — what a reconnecting client re-derives from', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    expect(await lock.read(SUBJECT)).toEqual({ turnId: TURN, startedAt: 1 })
    expect(getRedisData).toHaveBeenCalledWith(KEY)
  })

  it('returns null when no turn is open', async () => {
    getRedisData.mockResolvedValue(null)
    expect(await lock.read(SUBJECT)).toBeNull()
  })

  it('reads as "no turn open" when Redis throws — fails OPEN (invariant 3)', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    expect(await lock.read(SUBJECT)).toBeNull()
  })
})

describe('release (invariant 2: turn-checked)', () => {
  it('releases when the slot belongs to this turn', async () => {
    getRedisData.mockResolvedValue({ turnId: TURN, startedAt: 1 })
    expect(await lock.release(SUBJECT, TURN)).toBe(true)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
  })

  // THE safety property: a superseded turn's late turn-end must not unlock the
  // subject while a fresher turn is still writing.
  it('refuses to release a DIFFERENT turn’s lock', async () => {
    getRedisData.mockResolvedValue({ turnId: OTHER, startedAt: 1 })
    expect(await lock.release(SUBJECT, TURN)).toBe(false)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('no lock held ⇒ nothing released, nothing thrown', async () => {
    getRedisData.mockResolvedValue(null)
    expect(await lock.release(SUBJECT, TURN)).toBe(false)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('fails OPEN when Redis throws — reports it did not hold the lock', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    expect(await lock.release(SUBJECT, TURN)).toBe(false)
  })
})

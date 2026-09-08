// packages/lib/src/turn-scoped/__tests__/turn-slot.test.ts
//
// The four invariants named in `turn-slot.ts`, pinned once here so the three
// domain modules that now delegate (workflow graph, KB article, dashboard
// layout) cannot each get one subtly wrong again.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRedisData = vi.fn()
const setRedisData = vi.fn()
const deleteRedisData = vi.fn()

vi.mock('@auxx/redis', () => ({
  getRedisData: (...a: unknown[]) => getRedisData(...a),
  setRedisData: (...a: unknown[]) => setRedisData(...a),
  deleteRedisData: (...a: unknown[]) => deleteRedisData(...a),
}))

import { createTurnSlot } from '../turn-slot'

interface Snap {
  turnId: string
  body: string
  postHash?: string
  endedAs?: string
}

const SUBJECT = 'subject-1'
const TURN = 'turn-1'
const OTHER = 'turn-2'
const KEY = `test:${SUBJECT}:preturn`
const TTL = 3600

const slot = createTurnSlot<Snap>({
  key: (id) => `test:${id}:preturn`,
  ttlSeconds: TTL,
  logScope: 'turn-slot-test',
})

const stored = (over: Partial<Snap> = {}): Snap => ({ turnId: TURN, body: 'before', ...over })

beforeEach(() => {
  getRedisData.mockReset().mockResolvedValue(null)
  setRedisData.mockReset().mockResolvedValue('OK')
  deleteRedisData.mockReset().mockResolvedValue(1)
})

describe('capture (invariant 1: idempotent within a turn)', () => {
  it('writes under the slot key with the configured TTL, and reports that it wrote', async () => {
    expect(await slot.capture(SUBJECT, stored())).toBe(true)
    expect(setRedisData).toHaveBeenCalledWith(KEY, stored(), TTL)
  })

  it('leaves THIS turn’s record untouched — a second write must not bump it', async () => {
    getRedisData.mockResolvedValue(stored({ body: 'before' }))
    expect(await slot.capture(SUBJECT, stored({ body: 'later' }))).toBe(false)
    expect(setRedisData).not.toHaveBeenCalled()
  })

  it('overwrites a PRIOR turn’s record — the new turn supersedes it', async () => {
    getRedisData.mockResolvedValue(stored({ turnId: OTHER }))
    expect(await slot.capture(SUBJECT, stored())).toBe(true)
    expect(setRedisData).toHaveBeenCalledWith(KEY, stored(), TTL)
  })

  it('propagates a Redis failure (invariant 4) — a caller must never believe it captured', async () => {
    setRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.capture(SUBJECT, stored())).rejects.toThrow('down')
  })
})

describe('read (invariant 2: turn-checked)', () => {
  it('returns the record when no turn is asked for', async () => {
    getRedisData.mockResolvedValue(stored())
    expect(await slot.read(SUBJECT)).toEqual(stored())
    expect(getRedisData).toHaveBeenCalledWith(KEY)
  })

  it('returns the record for its own turn', async () => {
    getRedisData.mockResolvedValue(stored())
    expect(await slot.read(SUBJECT, TURN)).toEqual(stored())
  })

  it('returns null for a DIFFERENT turn — this is how a stale caller detects it was superseded', async () => {
    getRedisData.mockResolvedValue(stored({ turnId: OTHER }))
    expect(await slot.read(SUBJECT, TURN)).toBeNull()
  })

  it('an empty slot and a superseded one are indistinguishable — neither has anything to recover', async () => {
    getRedisData.mockResolvedValue(null)
    expect(await slot.read(SUBJECT, TURN)).toBeNull()
  })

  it('propagates a Redis failure (invariant 4)', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.read(SUBJECT)).rejects.toThrow('down')
  })
})

describe('patch (invariant 3: additive, TTL-refreshing)', () => {
  it('merges the fields and refreshes the TTL', async () => {
    getRedisData.mockResolvedValue(stored())
    await slot.patch(SUBJECT, TURN, { postHash: 'h1' })
    expect(setRedisData).toHaveBeenCalledWith(KEY, { ...stored(), postHash: 'h1' }, TTL)
  })

  it('never deletes — the record survives the patch', async () => {
    getRedisData.mockResolvedValue(stored())
    await slot.patch(SUBJECT, TURN, { endedAs: 'aborted' })
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('a stale turn relabels nothing', async () => {
    getRedisData.mockResolvedValue(stored({ turnId: OTHER }))
    await slot.patch(SUBJECT, TURN, { endedAs: 'error' })
    expect(setRedisData).not.toHaveBeenCalled()
  })

  it('patching a slot that was never written creates nothing', async () => {
    getRedisData.mockResolvedValue(null)
    await slot.patch(SUBJECT, TURN, { postHash: 'h1' })
    expect(setRedisData).not.toHaveBeenCalled()
  })

  // Not an optimization: a re-`setex` refreshes the TTL, so a no-op patch that
  // still wrote would silently extend how long a record outlives its turn.
  it('skips the WRITE entirely when every field already holds its target value', async () => {
    getRedisData.mockResolvedValue(stored({ postHash: 'h1' }))
    await slot.patch(SUBJECT, TURN, { postHash: 'h1' })
    expect(setRedisData).not.toHaveBeenCalled()
  })

  it('still writes when only one of several fields changed', async () => {
    getRedisData.mockResolvedValue(stored({ postHash: 'h1' }))
    await slot.patch(SUBJECT, TURN, { postHash: 'h1', endedAs: 'exhausted' })
    expect(setRedisData).toHaveBeenCalledWith(
      KEY,
      { ...stored(), postHash: 'h1', endedAs: 'exhausted' },
      TTL
    )
  })

  it('swallows a Redis failure (invariant 4) — turn-end paths must not throw', async () => {
    getRedisData.mockResolvedValue(stored())
    setRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.patch(SUBJECT, TURN, { postHash: 'h1' })).resolves.toBeUndefined()
  })

  it('swallows a failing READ too', async () => {
    getRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.patch(SUBJECT, TURN, { postHash: 'h1' })).resolves.toBeUndefined()
  })
})

describe('finalize (turn-checked delete)', () => {
  it('discards this turn’s record', async () => {
    getRedisData.mockResolvedValue(stored())
    await slot.finalize(SUBJECT, TURN)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
  })

  it('a stale turn never discards a fresher turn’s record', async () => {
    getRedisData.mockResolvedValue(stored({ turnId: OTHER }))
    await slot.finalize(SUBJECT, TURN)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('an empty slot is a no-op', async () => {
    getRedisData.mockResolvedValue(null)
    await slot.finalize(SUBJECT, TURN)
    expect(deleteRedisData).not.toHaveBeenCalled()
  })

  it('swallows a Redis failure — a leftover record expires via TTL', async () => {
    getRedisData.mockResolvedValue(stored())
    deleteRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.finalize(SUBJECT, TURN)).resolves.toBeUndefined()
  })
})

describe('clear (unconditional delete)', () => {
  // The non-agent write path saying "the subject moved under you": it must not
  // have to know which turn is open to protect hand-made edits.
  it('deletes without reading the record at all — no turn check', async () => {
    await slot.clear(SUBJECT)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
    expect(getRedisData).not.toHaveBeenCalled()
  })

  it('deletes a record belonging to some OTHER turn', async () => {
    getRedisData.mockResolvedValue(stored({ turnId: OTHER }))
    await slot.clear(SUBJECT)
    expect(deleteRedisData).toHaveBeenCalledWith(KEY)
  })

  it('swallows a Redis failure', async () => {
    deleteRedisData.mockRejectedValue(new Error('down'))
    await expect(slot.clear(SUBJECT)).resolves.toBeUndefined()
  })
})

describe('key scoping', () => {
  it('one slot per subject — the key builder is what separates them', async () => {
    await slot.clear('other-subject')
    expect(deleteRedisData).toHaveBeenCalledWith('test:other-subject:preturn')
  })
})

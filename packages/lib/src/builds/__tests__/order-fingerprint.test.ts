// packages/lib/src/builds/__tests__/order-fingerprint.test.ts
//
// The whole of Model A+ rests on this function being STABLE for a change that is
// not a change and DIFFERENT for one that is. Both failure modes are silent: a
// hash that moves on a no-op makes every order look drifted until people stop
// looking, and one that fails to move on a real edit is the defect plan 13 §0
// exists to fix, reintroduced with a field to make it look handled.

import { describe, expect, it } from 'vitest'
import type { AutoBuildLine } from '../auto-build-policy'
import { hasDrifted, orderDemandFingerprint } from '../order-fingerprint'

const LIFT = 'part_lift'
const MOTOR = 'part_motor'

const fp = (lines: AutoBuildLine[], cancelledAt: Date | null = null) =>
  orderDemandFingerprint({ cancelledAt, lines })

describe('what does not change the fingerprint', () => {
  it('is stable across runs for the same demand', () => {
    expect(fp([{ partId: LIFT, quantity: 3 }])).toBe(fp([{ partId: LIFT, quantity: 3 }]))
  })

  it('ignores LINE ORDER — the same lines read back differently are the same demand', () => {
    const a = fp([
      { partId: LIFT, quantity: 3 },
      { partId: MOTOR, quantity: 1 },
    ])
    const b = fp([
      { partId: MOTOR, quantity: 1 },
      { partId: LIFT, quantity: 3 },
    ])
    expect(a).toBe(b)
  })

  it('ignores a line SPLIT — 2 + 3 asks the floor for exactly what 5 did', () => {
    const split = fp([
      { partId: LIFT, quantity: 2 },
      { partId: LIFT, quantity: 3 },
    ])
    expect(split).toBe(fp([{ partId: LIFT, quantity: 5 }]))
  })

  it('ignores a line whose quantity is zero or negative', () => {
    const withNoise = fp([
      { partId: LIFT, quantity: 3 },
      { partId: MOTOR, quantity: 0 },
      { partId: 'part_ghost', quantity: -2 },
    ])
    expect(withNoise).toBe(fp([{ partId: LIFT, quantity: 3 }]))
  })

  it('ignores a non-finite quantity rather than hashing NaN', () => {
    expect(
      fp([
        { partId: LIFT, quantity: 3 },
        { partId: MOTOR, quantity: Number.NaN },
      ])
    ).toBe(fp([{ partId: LIFT, quantity: 3 }]))
  })

  it('ignores WHEN an order was cancelled — only that it was', () => {
    const lines = [{ partId: LIFT, quantity: 3 }]
    expect(fp(lines, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      fp(lines, new Date('2026-08-28T12:34:56.000Z'))
    )
  })
})

describe('what does change the fingerprint', () => {
  it('a quantity edit', () => {
    expect(fp([{ partId: LIFT, quantity: 3 }])).not.toBe(fp([{ partId: LIFT, quantity: 5 }]))
  })

  it('a part swap', () => {
    expect(fp([{ partId: LIFT, quantity: 3 }])).not.toBe(fp([{ partId: MOTOR, quantity: 3 }]))
  })

  it('an added line', () => {
    expect(fp([{ partId: LIFT, quantity: 3 }])).not.toBe(
      fp([
        { partId: LIFT, quantity: 3 },
        { partId: MOTOR, quantity: 1 },
      ])
    )
  })

  it('a deleted line', () => {
    expect(
      fp([
        { partId: LIFT, quantity: 3 },
        { partId: MOTOR, quantity: 1 },
      ])
    ).not.toBe(fp([{ partId: LIFT, quantity: 3 }]))
  })

  it('cancelling the order', () => {
    const lines = [{ partId: LIFT, quantity: 3 }]
    expect(fp(lines)).not.toBe(fp(lines, new Date('2026-08-28T00:00:00.000Z')))
  })

  it('distinguishes a CANCELLED order from one whose lines were all removed', () => {
    // Both ask production for nothing, and they are not the same fact: one is a
    // dead order, the other an empty one somebody is still typing.
    expect(fp([], new Date('2026-08-28T00:00:00.000Z'))).not.toBe(fp([]))
  })

  it('distinguishes an empty order from one with a line', () => {
    expect(fp([])).not.toBe(fp([{ partId: LIFT, quantity: 1 }]))
  })

  it('does not collide two parts whose ids share a prefix', () => {
    expect(fp([{ partId: 'part_a', quantity: 1 }])).not.toBe(
      fp([{ partId: 'part_ab', quantity: 1 }])
    )
  })

  it('does not confuse a quantity with a part id', () => {
    expect(fp([{ partId: '1', quantity: 2 }])).not.toBe(fp([{ partId: '2', quantity: 1 }]))
  })
})

describe('hasDrifted', () => {
  it('is true only when both stamps exist and differ', () => {
    expect(hasDrifted('a', 'b')).toBe(true)
  })

  it('is false when they agree', () => {
    expect(hasDrifted('a', 'a')).toBe(false)
  })

  it.each([
    ['a build with no stamp', null, 'a'],
    ['an order with no fingerprint', 'a', null],
    ['neither side stamped', null, null],
    ['an empty string, which is not a hash', '', 'a'],
  ])('reads %s as UNKNOWN, never as drifted', (_label, build, order) => {
    // A hand-raised build and a pre-migration order are both unknown. Calling
    // them drifted would light up every historical build at once and teach
    // everyone to ignore the signal.
    expect(hasDrifted(build, order)).toBe(false)
  })
})

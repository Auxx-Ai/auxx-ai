// packages/lib/src/permissions/capabilities/rung.test.ts

import { describe, expect, it } from 'vitest'
import { ALL_RUNGS, maxRung, RUNG_ORDER, type Rung, rungRank, satisfiesRung } from './rung'

describe('Rung ladder', () => {
  it('orders all six rungs none < metadata < identity < read < edit < admin', () => {
    expect(ALL_RUNGS).toEqual(['none', 'metadata', 'identity', 'read', 'edit', 'admin'])
    for (let i = 1; i < ALL_RUNGS.length; i++) {
      const lower = ALL_RUNGS[i - 1] as Rung
      const higher = ALL_RUNGS[i] as Rung
      expect(rungRank(lower), `${lower} < ${higher}`).toBeLessThan(rungRank(higher))
    }
  })

  it('covers every rung exactly once in RUNG_ORDER, with no duplicate ordinals', () => {
    expect(Object.keys(RUNG_ORDER).sort()).toEqual([...ALL_RUNGS].sort())
    expect(new Set(Object.values(RUNG_ORDER)).size).toBe(ALL_RUNGS.length)
  })

  it("ranks 'none' at the bottom — it is a restriction marker, never a grant", () => {
    for (const rung of ALL_RUNGS) {
      if (rung === 'none') continue
      expect(satisfiesRung('none', rung), `none should not satisfy ${rung}`).toBe(false)
      expect(satisfiesRung(rung, 'none'), `${rung} should satisfy none`).toBe(true)
    }
  })
})

describe('satisfiesRung', () => {
  it('is true at exactly the pairs where have >= need, at every boundary', () => {
    for (const have of ALL_RUNGS) {
      for (const need of ALL_RUNGS) {
        expect(satisfiesRung(have, need), `${have} vs ${need}`).toBe(
          RUNG_ORDER[have] >= RUNG_ORDER[need]
        )
      }
    }
  })

  it('is reflexive on every rung', () => {
    for (const rung of ALL_RUNGS) expect(satisfiesRung(rung, rung)).toBe(true)
  })

  it('is exact on each adjacent boundary', () => {
    expect(satisfiesRung('metadata', 'identity')).toBe(false)
    expect(satisfiesRung('identity', 'metadata')).toBe(true)
    expect(satisfiesRung('identity', 'read')).toBe(false)
    expect(satisfiesRung('read', 'identity')).toBe(true)
    expect(satisfiesRung('read', 'edit')).toBe(false)
    expect(satisfiesRung('edit', 'read')).toBe(true)
    expect(satisfiesRung('edit', 'admin')).toBe(false)
    expect(satisfiesRung('admin', 'edit')).toBe(true)
  })
})

describe('maxRung', () => {
  it('returns the higher rung in either argument order', () => {
    for (const a of ALL_RUNGS) {
      for (const b of ALL_RUNGS) {
        const expected = RUNG_ORDER[a] >= RUNG_ORDER[b] ? a : b
        expect(maxRung(a, b), `max(${a}, ${b})`).toBe(expected)
        expect(rungRank(maxRung(b, a))).toBe(rungRank(expected))
      }
    }
  })

  it('never lets a none restriction win against a real grant', () => {
    for (const rung of ALL_RUNGS) {
      if (rung === 'none') continue
      expect(maxRung('none', rung)).toBe(rung)
      expect(maxRung(rung, 'none')).toBe(rung)
    }
  })
})

// apps/web/src/server/api/build-legs.test.ts

import { describe, expect, it } from 'vitest'
import { compareBuildLegs } from './build-legs'

const leg = (id: string, type: string, quantity: number, partName: string | null) => ({
  id,
  type,
  quantity,
  partName,
})

describe('compareBuildLegs', () => {
  it('puts the produce leg first on a normal build', () => {
    const legs = [
      leg('c2', 'build_consume', -2, 'Motor'),
      leg('p', 'build_produce', 1, 'Attic Lift'),
      leg('c1', 'build_consume', -4, 'Bracket'),
    ]
    expect(legs.sort(compareBuildLegs).map((l) => l.id)).toEqual(['p', 'c1', 'c2'])
  })

  it('puts the negated produce leg first on a reversing build too', () => {
    const legs = [
      leg('c2', 'build_consume', 2, 'Motor'),
      leg('c1', 'build_consume', 4, 'Bracket'),
      leg('p', 'build_produce', -1, 'Attic Lift'),
    ]
    expect(legs.sort(compareBuildLegs).map((l) => l.id)).toEqual(['p', 'c1', 'c2'])
  })

  it('breaks a tie on part name by id, so the order is stable', () => {
    const legs = [leg('b', 'build_consume', -1, null), leg('a', 'build_consume', -1, null)]
    expect(legs.sort(compareBuildLegs).map((l) => l.id)).toEqual(['a', 'b'])
  })
})

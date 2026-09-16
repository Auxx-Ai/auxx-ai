// packages/lib/src/postings/__tests__/delivery-coverage.test.ts
import { describe, expect, it } from 'vitest'
import {
  type CoverageComponent,
  contributionLineKeys,
  findCoveragePartitionProblems,
} from '../delivery-coverage'

const contribution = ['clearing', 'revenue', 'tax']
const check = (components: CoverageComponent[]) =>
  findCoveragePartitionProblems({ contributionLineKeys: contribution, components })

describe('component coverage partitions one effect', () => {
  it('accepts the whole effect on its own', () => {
    expect(check([{ componentKey: 'whole_effect', lineKeys: null }])).toEqual([])
  })

  it('accepts components that cover every contribution line exactly once', () => {
    expect(
      check([
        { componentKey: 'invoice', lineKeys: ['revenue', 'tax'] },
        { componentKey: 'payment', lineKeys: ['clearing'] },
      ])
    ).toEqual([])
  })

  it('refuses an effect nothing covers at all', () => {
    expect(check([])).toEqual(['Effect has no delivery coverage'])
  })

  it('refuses a gap, naming the line that would never be sent', () => {
    expect(check([{ componentKey: 'invoice', lineKeys: ['revenue', 'tax'] }])).toEqual([
      'Contribution line clearing is not covered',
    ])
  })

  it('refuses an overlap, which is the double-send brief 44 asks us to prove against', () => {
    expect(
      check([
        { componentKey: 'invoice', lineKeys: ['revenue', 'tax'] },
        { componentKey: 'payment', lineKeys: ['clearing', 'tax'] },
      ])
    ).toEqual(['Contribution line tax is covered twice'])
  })

  it('refuses a line the effect does not have', () => {
    expect(
      check([{ componentKey: 'invoice', lineKeys: ['clearing', 'revenue', 'tax', 'shipping'] }])
    ).toEqual(['Component invoice names unknown line shipping'])
  })

  it('refuses the whole effect and a component claiming it together', () => {
    expect(
      check([
        { componentKey: 'whole_effect', lineKeys: null },
        { componentKey: 'invoice', lineKeys: ['revenue'] },
      ])
    ).toEqual(['Whole-effect coverage cannot coexist with component coverage'])
  })

  it('refuses a duplicate component key', () => {
    expect(
      check([
        { componentKey: 'invoice', lineKeys: ['revenue', 'tax'] },
        { componentKey: 'invoice', lineKeys: ['clearing'] },
      ])
    ).toEqual(['Duplicate component key'])
  })

  it('refuses a whole-effect row that also names lines', () => {
    expect(check([{ componentKey: 'whole_effect', lineKeys: ['revenue'] }])).toEqual([
      'Whole-effect coverage must not name individual contribution lines',
    ])
  })

  it('refuses a partial component that names nothing', () => {
    expect(check([{ componentKey: 'invoice', lineKeys: [] }])).toEqual([
      'Component invoice names no contribution lines',
      'Contribution line clearing is not covered',
      'Contribution line revenue is not covered',
      'Contribution line tax is not covered',
    ])
  })

  it('reports every problem rather than the first', () => {
    expect(
      check([
        { componentKey: 'invoice', lineKeys: ['revenue', 'shipping'] },
        { componentKey: 'payment', lineKeys: ['revenue'] },
      ])
    ).toEqual([
      'Component invoice names unknown line shipping',
      'Contribution line revenue is covered twice',
      'Contribution line clearing is not covered',
      'Contribution line tax is not covered',
    ])
  })

  it('reads contribution line keys off an accepted basis and tolerates a missing one', () => {
    expect(
      contributionLineKeys({ contribution: [{ lineKey: 'a' }, { lineKey: 'b' }, {}] })
    ).toEqual(['a', 'b'])
    expect(contributionLineKeys(null)).toEqual([])
    expect(contributionLineKeys({})).toEqual([])
  })
})

// apps/web/src/components/money/ui/line-builder/lines-cache.test.ts

import type { Line } from '@auxx/lib/accounting/documents/lines/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))
vi.mock('~/realtime/hooks', () => ({ useRecordChannels: vi.fn() }))

const { spliceLinesAfter, upsertLines } = await import('./lines-cache')

function line(id: string, sortOrder: number | null, visitId: string | null = null): Line {
  return { id, sortOrder, visitId } as Line
}

const QUOTE = { documentType: 'quote' as const, documentId: 'q1' }

describe('upsertLines', () => {
  it('replaces by id and keeps the server order', () => {
    const next = upsertLines([line('a', 0), line('b', 1)], [line('b', 1), line('c', 2)], QUOTE)
    expect(next.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('re-sorts a moved line, nulls last', () => {
    const next = upsertLines([line('a', 0), line('b', 1), line('n', null)], [line('a', 5)], QUOTE)
    expect(next.map((l) => l.id)).toEqual(['b', 'a', 'n'])
  })

  it('splits a work order on the visit', () => {
    const jobList = { documentType: 'work_order' as const, documentId: 'w1' }
    const visitList = { ...jobList, visitId: 'v1' }
    const extra = line('x', 0, 'v1')
    expect(upsertLines([], [extra], jobList)).toEqual([])
    expect(upsertLines([], [extra], visitList)).toEqual([extra])
    // A line that moved to a visit leaves the job's list.
    expect(upsertLines([line('x', 0)], [extra], jobList)).toEqual([])
  })
})

describe('spliceLinesAfter', () => {
  it('inserts after the anchor and renumbers, as the server does', () => {
    const next = spliceLinesAfter(
      [line('a', 0), line('b', 1), line('c', 2)],
      'a',
      [line('n1', 1), line('n2', 2)],
      QUOTE
    )
    expect(next.map((l) => [l.id, l.sortOrder])).toEqual([
      ['a', 0],
      ['n1', 1],
      ['n2', 2],
      ['b', 3],
      ['c', 4],
    ])
  })

  it('appends when the anchor is gone', () => {
    const next = spliceLinesAfter([line('a', 0)], 'gone', [line('n', 1)], QUOTE)
    expect(next.map((l) => l.id)).toEqual(['a', 'n'])
  })
})

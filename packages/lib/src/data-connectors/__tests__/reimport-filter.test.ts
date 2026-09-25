// packages/lib/src/data-connectors/__tests__/reimport-filter.test.ts

import { describe, expect, it } from 'vitest'
import type { ConnectorRecord } from '../connectors/types'
import { recordMatchesFilter } from '../record-filter'
import { periodFilterGroup, type ReimportQuery, validateReimportQuery } from '../reimport-filter'
import { missingQueryCapability } from '../stream-query'

describe('validateReimportQuery', () => {
  it('reads ids as an id run, deduped', () => {
    expect(validateReimportQuery({ ids: ['1', '2', '1'] })._unsafeUnwrap()).toEqual({
      kind: 'id',
      query: { ids: ['1', '2'] },
    })
  })

  it('refuses an empty, blank or oversized id list', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => String(i))
    for (const ids of [[], [''], ['  '], tooMany]) {
      expect(validateReimportQuery({ ids }).isErr(), JSON.stringify(ids)).toBe(true)
    }
  })

  it('normalises a period to UTC ISO bounds', () => {
    const result = validateReimportQuery({
      period: { from: '2026-08-01', to: '2026-09-01T00:00:00-07:00' },
    })
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'period',
      query: { period: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T07:00:00.000Z' } },
    })
  })

  it('accepts a half-open period', () => {
    expect(validateReimportQuery({ period: { from: '2026-08-01' } })._unsafeUnwrap().query).toEqual(
      {
        period: { from: '2026-08-01T00:00:00.000Z' },
      }
    )
  })

  it('refuses a period with no bound, a bad date, or an inverted range', () => {
    const bad: ReimportQuery[] = [
      { period: {} },
      { period: { from: 'nope' } },
      { period: { from: '2026-09-01', to: '2026-08-01' } },
    ]
    for (const input of bad) {
      expect(validateReimportQuery(input).isErr(), JSON.stringify(input)).toBe(true)
    }
  })

  it('refuses both ids and a period at once', () => {
    const both = { ids: ['1'], period: { from: '2026-08-01' } } as unknown as ReimportQuery
    expect(validateReimportQuery(both).isErr()).toBe(true)
  })
})

describe('missingQueryCapability (the pre-run refusal)', () => {
  it('names the capability a stream does not declare', () => {
    expect(missingQueryCapability(undefined, { ids: ['1'] })).toBe('ids')
    expect(missingQueryCapability({ ids: true }, { period: { from: 'x' } })).toBe('period')
  })

  it('passes a query the stream declares', () => {
    expect(missingQueryCapability({ ids: true }, { ids: ['1'] })).toBeNull()
    expect(missingQueryCapability({ period: 'created_at' }, { period: { to: 'x' } })).toBeNull()
  })
})

describe('periodFilterGroup', () => {
  const record = (createdAt: unknown) =>
    ({ streamKey: 'order', fields: { created_at: createdAt } }) as ConnectorRecord
  const august = periodFilterGroup('created_at', {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
  })

  it('re-checks the declared period path post-fetch', () => {
    expect(recordMatchesFilter(record('2026-08-15T10:00:00Z'), [august]).matched).toBe(true)
    expect(recordMatchesFilter(record('2026-07-31T23:59:59Z'), [august]).matched).toBe(false)
    expect(recordMatchesFilter(record('2026-09-02T00:00:00Z'), [august]).matched).toBe(false)
  })

  it('skips a record without the period path', () => {
    expect(recordMatchesFilter(record(undefined), [august]).matched).toBe(false)
  })
})

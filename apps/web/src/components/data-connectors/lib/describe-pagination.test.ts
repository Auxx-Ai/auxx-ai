// apps/web/src/components/data-connectors/lib/describe-pagination.test.ts
import { describe, expect, it } from 'vitest'
import { describePagination } from './describe-pagination'

describe('describePagination', () => {
  it('renders the blunt single-page copy for kind:none (and undefined)', () => {
    for (const spec of [undefined, { kind: 'none' as const }]) {
      const d = describePagination(spec)
      expect(d.badge).toBe('Single page')
      expect(d.summary).toMatch(/no further pages/)
      // none has no stop condition / page size rows.
      expect(d.details).toEqual([])
    }
  })

  it('describes a Stripe-style last-record cursor', () => {
    const d = describePagination({
      kind: 'cursor',
      cursorFrom: 'lastRecord',
      cursorRecordField: 'id',
      hasMorePath: 'has_more',
      recordsPath: 'data',
      pageSize: 100,
    })
    expect(d.badge).toBe('Cursor')
    const byLabel = Object.fromEntries(d.details.map((r) => [r.label, r.value]))
    expect(byLabel['Next page from']).toMatch(/“id” of the last record/)
    expect(byLabel['Stops when']).toMatch(/has_more = false/)
    expect(byLabel['Page size']).toMatch(/100 records/)
  })

  it('describes a response-field cursor', () => {
    const d = describePagination({
      kind: 'cursor',
      cursorFrom: 'response',
      cursorPath: 'paging.next.after',
    })
    const byLabel = Object.fromEntries(d.details.map((r) => [r.label, r.value]))
    expect(byLabel['Next page from']).toMatch(/“paging.next.after” field/)
    expect(byLabel['Stops when']).toMatch(/no next token/)
  })

  it('describes link-header, next-url, page and offset', () => {
    expect(describePagination({ kind: 'link-header' }).badge).toBe('Link header')
    expect(describePagination({ kind: 'next-url', nextUrlPath: 'nextRecordsUrl' }).summary).toMatch(
      /next-page URL/
    )
    expect(describePagination({ kind: 'page' }).details[0].value).toMatch(/empty/)
    expect(describePagination({ kind: 'offset' }).details[0].value).toMatch(/fewer records/)
  })

  it('adds the history row from the connector history start date', () => {
    const d = describePagination(
      { kind: 'cursor', cursorPath: 'next' },
      { historyStartDate: '2025-01-01' }
    )
    const byLabel = Object.fromEntries(d.details.map((r) => [r.label, r.value]))
    expect(byLabel['History from']).toBe('Jan 1, 2025')
  })

  it('falls back to a stream page-size when the spec omits one', () => {
    const d = describePagination({ kind: 'page' }, { pageSizeFallback: 250 })
    const byLabel = Object.fromEntries(d.details.map((r) => [r.label, r.value]))
    expect(byLabel['Page size']).toMatch(/250 records/)
  })
})

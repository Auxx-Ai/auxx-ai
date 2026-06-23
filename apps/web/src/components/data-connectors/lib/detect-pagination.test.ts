// apps/web/src/components/data-connectors/lib/detect-pagination.test.ts
import { describe, expect, it } from 'vitest'
import { detectPagination } from './detect-pagination'

describe('detectPagination', () => {
  it('detects a GitHub-style link header', () => {
    const r = detectPagination({
      body: [{ id: 1 }],
      headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
      pageRecordCount: 1,
    })
    expect(r.spec.kind).toBe('link-header')
    expect(r.confidence).toBe('high')
  })

  it('detects a Stripe-style has_more + last-record id cursor', () => {
    const r = detectPagination({
      body: { object: 'list', has_more: true, data: [{ id: 'cus_1' }, { id: 'cus_2' }] },
      pageRecordCount: 2,
    })
    expect(r.spec).toMatchObject({
      kind: 'cursor',
      cursorFrom: 'lastRecord',
      cursorRecordField: 'id',
      hasMorePath: 'has_more',
      recordsPath: 'data',
    })
  })

  it('prefers a body cursor field when has_more carries one', () => {
    const r = detectPagination({
      body: { has_more: true, results: [{ x: 1 }], next_cursor: 'abc' },
      pageRecordCount: 1,
    })
    expect(r.spec).toMatchObject({
      kind: 'cursor',
      cursorFrom: 'response',
      cursorPath: 'next_cursor',
    })
  })

  it('detects a HubSpot-style paging.next.after cursor without has_more', () => {
    const r = detectPagination({
      body: { results: [{ id: '1' }], paging: { next: { after: '10' } } },
      pageRecordCount: 1,
    })
    expect(r.spec).toMatchObject({ kind: 'cursor', cursorPath: 'paging.next.after' })
  })

  it('detects a Salesforce-style next-url in the body', () => {
    const r = detectPagination({
      body: { done: false, nextRecordsUrl: '/services/data/v60.0/query/01g-2000', records: [{}] },
      pageRecordCount: 1,
    })
    expect(r.spec).toMatchObject({ kind: 'next-url', nextUrlPath: 'nextRecordsUrl' })
  })

  it('detects a QuickBooks-style 1-based offset', () => {
    const r = detectPagination({
      body: { startPosition: 1, totalCount: 50, Invoice: [{}] },
      pageRecordCount: 1,
    })
    expect(r.spec).toMatchObject({ kind: 'offset', offsetBase: 1 })
  })

  it('falls back to none, warning when the page looks full (the truncation case)', () => {
    const full = detectPagination({
      body: [{ id: 1 }, { id: 2 }],
      pageRecordCount: 2,
      pageLimit: 2,
    })
    expect(full.spec.kind).toBe('none')
    expect(full.note).toMatch(/likely more pages/)

    const short = detectPagination({ body: [{ id: 1 }], pageRecordCount: 1, pageLimit: 100 })
    expect(short.spec.kind).toBe('none')
    expect(short.note).toBeUndefined()
  })
})

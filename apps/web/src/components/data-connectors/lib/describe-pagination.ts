// apps/web/src/components/data-connectors/lib/describe-pagination.ts
// Pure, client-safe translator: a stream's `PaginationSpec` → plain-language copy
// for the read-only "How this paginates" display (Step 10 §3.2). Mirrors how the
// engine actually pages (generic-rest.ts) so the words never lie about behaviour —
// notably `none` is rendered bluntly ("Single page · no further pages") so a capped
// fetch can't hide. No server imports; a local `PaginationSpec` (the few fields we
// read) avoids pulling a server-only module into the client bundle (CLAUDE.md rule).

/** The pagination fields the display reads — a structural subset of the engine spec. */
export interface PaginationSpec {
  kind: 'cursor' | 'page' | 'offset' | 'link-header' | 'next-url' | 'none'
  cursorParam?: string
  cursorPath?: string
  cursorFrom?: 'response' | 'lastRecord'
  cursorRecordField?: string
  recordsPath?: string
  hasMorePath?: string
  nextUrlPath?: string
  pageParam?: string
  offsetBase?: 0 | 1
  limitParam?: string
  pageSize?: number
}

/** Matches `schedule-section.tsx` — the connector-level backfill window span. */
export type BackfillWindowSpan = 'all' | 'last_90_days' | 'last_12_months'

const WINDOW_LABEL: Record<BackfillWindowSpan, string> = {
  all: 'All history',
  last_12_months: 'Last 12 months',
  last_90_days: 'Last 90 days',
}

export interface PaginationDescription {
  /** Short chip label — the collapsed view shows only this. */
  badge: string
  /** One plain-language line describing how it advances. */
  summary: string
  /** Expanded detail rows: how it advances, when it stops, page size, history window. */
  details: { label: string; value: string }[]
}

interface DescribeOpts {
  /** Set when the connector has a backfill-window span configured. */
  backfillWindowSpan?: BackfillWindowSpan
  /** A stream-level page-size fallback (e.g. a `limit` query param) for the size row. */
  pageSizeFallback?: number
}

/**
 * Describe a `PaginationSpec` in end-user language. Reads only the spec — the same
 * object already returned on the stream — so it needs no fetch.
 */
export function describePagination(
  pagination: PaginationSpec | undefined,
  opts: DescribeOpts = {}
): PaginationDescription {
  const kind = pagination?.kind ?? 'none'
  const details: { label: string; value: string }[] = []

  const stops = stopCondition(pagination)
  if (stops && kind !== 'none') details.push({ label: 'Stops when', value: stops })

  // "Next page from" — only meaningful for cursor pagination.
  if (kind === 'cursor') {
    const from =
      pagination?.cursorFrom === 'lastRecord'
        ? `the “${pagination.cursorRecordField ?? 'id'}” of the last record`
        : pagination?.cursorPath
          ? `the “${pagination.cursorPath}” field of the response`
          : 'a token returned by the response'
    details.push({ label: 'Next page from', value: from })
  }

  const pageSize = pagination?.pageSize ?? opts.pageSizeFallback
  if (pageSize && kind !== 'none') {
    details.push({ label: 'Page size', value: `${pageSize.toLocaleString()} records per request` })
  }

  if (opts.backfillWindowSpan) {
    details.push({ label: 'History window', value: WINDOW_LABEL[opts.backfillWindowSpan] })
  }

  return { badge: BADGE[kind], summary: SUMMARY[kind], details }
}

const BADGE: Record<PaginationSpec['kind'], string> = {
  cursor: 'Cursor',
  'link-header': 'Link header',
  'next-url': 'Next URL',
  page: 'Page number',
  offset: 'Offset',
  none: 'Single page',
}

const SUMMARY: Record<PaginationSpec['kind'], string> = {
  cursor: 'Follows a token from each response to fetch the next page.',
  'link-header': 'Follows the next-page link in the response headers.',
  'next-url': 'Follows a next-page URL the API returns in each response.',
  page: 'Requests numbered pages (1, 2, 3…) until one comes back empty.',
  offset: 'Steps through records by position (offset + limit).',
  none: 'Makes one request and imports that response — no further pages are fetched.',
}

function stopCondition(pagination: PaginationSpec | undefined): string | undefined {
  switch (pagination?.kind) {
    case 'cursor':
      return pagination.hasMorePath
        ? `the API reports no more results (${pagination.hasMorePath} = false)`
        : 'the response returns no next token'
    case 'link-header':
      return 'there is no “next” link in the response headers'
    case 'next-url':
      return 'the response has no next-page URL'
    case 'page':
      return 'a page comes back empty'
    case 'offset':
      return 'a page returns fewer records than the limit'
    default:
      return undefined
  }
}

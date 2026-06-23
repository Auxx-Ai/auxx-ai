// apps/web/src/components/data-connectors/lib/detect-pagination.ts
// Pure, client-safe inference: given a Test Fetch's raw body + allowlisted response
// headers, propose a `PaginationSpec` (Step 10 §3.3). Inform-only — the result feeds
// the same read-only display labeled "Detected from test fetch". Priority-ordered;
// first match wins. No server imports.

import type { PaginationSpec } from './describe-pagination'

export interface PaginationDetection {
  spec: PaginationSpec
  /** `high` = a strong signal (link header / has_more / known cursor field); `guess` = fallback. */
  confidence: 'high' | 'guess'
  /** Optional caveat shown under the proposal (e.g. the full-page → likely-truncated warning). */
  note?: string
}

interface DetectInput {
  body: unknown
  /** Allowlisted response headers (lowercased keys) from `sampleFetch`. */
  headers?: Record<string, string>
  /** Records on the sampled page (the source's collection size). */
  pageRecordCount: number
  /** The configured page size / limit, if any, to flag a full (likely-truncated) page. */
  pageLimit?: number
}

/**
 * Infer how a source paginates from one sampled page. Returns `kind:'none'` when
 * nothing matches — with a warning when the page is full, since that's the
 * silent-truncation case (a `none` spec stops after page one).
 */
export function detectPagination(input: DetectInput): PaginationDetection {
  const { body, headers, pageRecordCount, pageLimit } = input
  const obj = isRecord(body) ? body : undefined

  // 1. Link header with rel="next" (GitHub, Salesforce REST sometimes). Mirrors the
  //    engine's parse in generic-rest.ts nextPageToken().
  const link = headers?.link
  if (link && /<[^>]+>;\s*rel="next"/.test(link)) {
    return { spec: { kind: 'link-header' }, confidence: 'high' }
  }

  if (obj) {
    const recordsPath = findRecordArrayPath(obj)
    const hasMore = typeof obj.has_more === 'boolean'

    // 2. has_more + a record array → Stripe/Notion-shaped cursor.
    if (hasMore && recordsPath) {
      const bodyCursor = firstPath(obj, ['next_cursor', 'paging.next.after', 'nextPageToken'])
      if (bodyCursor) {
        return {
          spec: {
            kind: 'cursor',
            cursorFrom: 'response',
            cursorPath: bodyCursor.path,
            hasMorePath: 'has_more',
            recordsPath,
          },
          confidence: 'high',
        }
      }
      // Stripe: next cursor = the last record's id; termination via has_more.
      const records = getByPath(obj, recordsPath)
      if (
        Array.isArray(records) &&
        records.length > 0 &&
        isRecord(records[0]) &&
        'id' in records[0]
      ) {
        return {
          spec: {
            kind: 'cursor',
            cursorParam: 'starting_after',
            cursorFrom: 'lastRecord',
            cursorRecordField: 'id',
            hasMorePath: 'has_more',
            recordsPath,
          },
          confidence: 'high',
        }
      }
    }

    // 3. A body cursor field without has_more (HubSpot / Notion / Google).
    const cursor = firstPath(obj, ['paging.next.after', 'next_cursor', 'nextPageToken'])
    if (cursor) {
      return {
        spec: { kind: 'cursor', cursorFrom: 'response', cursorPath: cursor.path },
        confidence: 'high',
      }
    }

    // 4. Server next-URL in the body (Salesforce nextRecordsUrl).
    const nextUrl = firstPath(obj, ['nextRecordsUrl', 'next'])
    if (nextUrl && typeof getByPath(obj, nextUrl.path) === 'string') {
      return { spec: { kind: 'next-url', nextUrlPath: nextUrl.path }, confidence: 'high' }
    }

    // 5. Offset/limit (QuickBooks STARTPOSITION → startPosition + totalCount).
    if ('startPosition' in obj && 'totalCount' in obj) {
      return { spec: { kind: 'offset', offsetBase: 1 }, confidence: 'guess' }
    }
  }

  // 6. Nothing matched → single page. Warn when the page is full: there are likely
  //    more pages this fetch won't reach (the Stripe-cap case).
  const truncated = pageLimit !== undefined && pageRecordCount >= pageLimit && pageRecordCount > 0
  return {
    spec: { kind: 'none' },
    confidence: 'guess',
    note: truncated
      ? "This page is full — there are likely more pages this fetch won't reach."
      : undefined,
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The first dotted path (from the candidates) whose value is present + truthy. */
function firstPath(obj: Record<string, unknown>, paths: string[]): { path: string } | undefined {
  for (const path of paths) {
    const value = getByPath(obj, path)
    if (value !== undefined && value !== null && value !== '') return { path }
  }
  return undefined
}

/** First top-level key whose value is an array — the page's record collection. */
function findRecordArrayPath(obj: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) return key
  }
  return undefined
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => (isRecord(acc) ? acc[seg] : undefined), obj)
}

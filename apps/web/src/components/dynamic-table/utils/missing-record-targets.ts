// apps/web/src/components/dynamic-table/utils/missing-record-targets.ts

'use client'

import { isRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { CopyCellPayload } from '../types'

/** The most ids one existence call will judge — matches the procedure's cap. */
const MAX_BATCH = 100

/**
 * Every RecordId a set of clipboard / fill payloads would write into a
 * relationship cell.
 *
 * Mirrors the two RecordId-bearing branches of `coerceForPaste`: the lossless
 * `source.recordId`, and the ", "-joined RecordId round-trip that copy falls back
 * to when the display name was not hydrated at copy time.
 */
export function collectPastedRecordIds(
  sources: Iterable<CopyCellPayload | null | undefined>
): RecordId[] {
  const found = new Set<RecordId>()
  for (const source of sources) {
    if (!source) continue
    if (typeof source.recordId === 'string' && isRecordId(source.recordId)) {
      found.add(source.recordId as RecordId)
    }
    const display = (source.display ?? '').trim()
    if (!display) continue
    const parts = display
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length > 0 && parts.every(isRecordId)) {
      for (const part of parts) found.add(part as RecordId)
    }
  }
  return [...found].slice(0, MAX_BATCH)
}

/** The narrow slice of `api.useUtils()` {@link resolveMissingRecordIds} needs. */
export interface MissingTargetsFetcher {
  fetch: (
    input: { items: string[] },
    opts?: { staleTime?: number }
  ) => Promise<{ missing: string[] }>
}

/**
 * Resolve which pasted RecordIds point at a hard-deleted record, so paste stops
 * cloning a dangling reference into another row.
 *
 * ⚠️ **Fails OPEN.** An error, a timeout or an unresolvable def yields an empty
 * set and the paste proceeds — the existence check exists to stop propagation of
 * a reference that is already broken, and refusing a valid paste because the
 * check could not run would be the worse failure. The server-side procedure is
 * likewise conservative: it never reports a target it cannot resolve to
 * `EntityInstance`, so a `thread:` or `article:` reference is never rejected.
 */
export async function resolveMissingRecordIds(
  fetcher: MissingTargetsFetcher,
  recordIds: RecordId[]
): Promise<Set<string>> {
  if (recordIds.length === 0) return new Set()
  try {
    const result = await fetcher.fetch({ items: recordIds }, { staleTime: 0 })
    return new Set(result.missing)
  } catch {
    return new Set()
  }
}

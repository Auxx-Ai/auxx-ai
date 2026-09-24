// packages/lib/src/import/resolution/get-file-fetch-counts.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import type { ResolvedValue } from '../types/resolution'

/** A resolution row whose image still has to be downloaded */
export interface PendingFileFetchRow {
  /** `ImportValueResolution.id`, the row the asset ref is written back to */
  resolutionId: string
  /** `ImportJobProperty.id`, the column's per-job identity */
  jobPropertyId: string
  sourceColumnIndex: number
  sourceColumnName: string | null
  targetFieldKey: string | null
  /** Normalised URL from the resolver's `fileFetch` marker */
  url: string
}

/** One column's pending image downloads */
export interface FileFetchColumnCount {
  jobPropertyId: string
  sourceColumnIndex: number
  sourceColumnName: string | null
  targetFieldKey: string | null
  /** Distinct URLs in this column */
  count: number
}

/** Preview-facing summary of the images `file:url` columns will download */
export interface FileFetchCounts {
  /** Distinct URLs across the whole job; the same URL in two columns downloads once */
  total: number
  byColumn: FileFetchColumnCount[]
}

/**
 * Every resolution of a job still carrying a `fileFetch` marker, whatever its status.
 *
 * Status is not filtered: a multi-URL cell resolves as `warning`, and an override keeps the
 * row's original status (`updateValueResolution` never touches it) while re-resolving the
 * corrected URL into a fresh marker — both must still be downloaded.
 */
export async function loadPendingFileFetches(
  db: Database,
  jobId: string
): Promise<PendingFileFetchRow[]> {
  const rows = await db
    .select({
      resolutionId: schema.ImportValueResolution.id,
      jobPropertyId: schema.ImportJobProperty.id,
      sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
      sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
      targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
      isValid: schema.ImportValueResolution.isValid,
      resolvedValues: schema.ImportValueResolution.resolvedValues,
    })
    .from(schema.ImportValueResolution)
    .innerJoin(
      schema.ImportJobProperty,
      eq(schema.ImportValueResolution.importJobPropertyId, schema.ImportJobProperty.id)
    )
    .innerJoin(
      schema.ImportMappingProperty,
      eq(schema.ImportJobProperty.importMappingPropertyId, schema.ImportMappingProperty.id)
    )
    .where(
      and(
        eq(schema.ImportJobProperty.importJobId, jobId),
        sql`${schema.ImportValueResolution.resolvedValues} -> 0 -> 'fileFetch' IS NOT NULL`
      )
    )

  const pending: PendingFileFetchRow[] = []
  for (const row of rows) {
    // A skip override empties `resolvedValues`; nothing to download.
    if (!row.isValid) continue
    const values = row.resolvedValues as ResolvedValue[] | null
    const url = Array.isArray(values) ? values[0]?.fileFetch?.url : undefined
    if (!url) continue
    pending.push({
      resolutionId: row.resolutionId,
      jobPropertyId: row.jobPropertyId,
      sourceColumnIndex: row.sourceColumnIndex,
      sourceColumnName: row.sourceColumnName,
      targetFieldKey: row.targetFieldKey,
      url,
    })
  }
  return pending
}

/**
 * Count the images the import will download, before anything is fetched — the preview's
 * "142 images will be downloaded".
 */
export async function getFileFetchCounts(db: Database, jobId: string): Promise<FileFetchCounts> {
  const pending = await loadPendingFileFetches(db, jobId)

  const all = new Set<string>()
  const byColumn = new Map<string, FileFetchColumnCount & { seen: Set<string> }>()
  for (const row of pending) {
    all.add(row.url)
    let column = byColumn.get(row.jobPropertyId)
    if (!column) {
      column = {
        jobPropertyId: row.jobPropertyId,
        sourceColumnIndex: row.sourceColumnIndex,
        sourceColumnName: row.sourceColumnName,
        targetFieldKey: row.targetFieldKey,
        count: 0,
        seen: new Set<string>(),
      }
      byColumn.set(row.jobPropertyId, column)
    }
    if (column.seen.has(row.url)) continue
    column.seen.add(row.url)
    column.count++
  }

  return {
    total: all.size,
    byColumn: [...byColumn.values()]
      .map(({ seen: _seen, ...rest }) => rest)
      .sort((a, b) => a.sourceColumnIndex - b.sourceColumnIndex),
  }
}

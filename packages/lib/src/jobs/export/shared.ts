// packages/lib/src/jobs/export/shared.ts
//
// Paging/hydration helpers shared by `export-records-job.ts` (CSV) and `print-records-job.ts`
// (PDF) — both page the same `ExportJob` snapshot the same way, they only differ in what they
// do with the formatted rows at the end (plans/printing/01-unified-print.md §D).

import type { FieldReference } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { extractRelationRecordIds } from '../../export'
import type { FieldValueService } from '../../field-values/field-value-service'
import type { TypedFieldValueResult } from '../../field-values/types'
import type { UnifiedCrudHandler } from '../../resources/crud/unified-handler'

/** Records paged from `listFiltered`/`recordIds` per iteration (also the `batchGetValues` id cap). */
export const PAGE_SIZE = 500
/** `batchGetValues` caps field references at 50 — chunk wide views. */
const FIELD_REF_CHUNK = 50
/** Related-name hydration chunk (Postgres `IN (...)` param ceiling). */
const NAME_CHUNK = 500

/**
 * Fetch field values for a page of records. `batchGetValues` caps field references
 * at 50, so wide views are fetched in chunks (same page re-queried per chunk) and
 * merged into one flat result array.
 */
export async function fetchValues(
  fvs: FieldValueService,
  recordIds: RecordId[],
  fieldRefs: FieldReference[]
): Promise<TypedFieldValueResult[]> {
  if (fieldRefs.length <= FIELD_REF_CHUNK) {
    const { values } = await fvs.batchGetValues({ recordIds, fieldReferences: fieldRefs })
    return values
  }

  const all: TypedFieldValueResult[] = []
  for (let i = 0; i < fieldRefs.length; i += FIELD_REF_CHUNK) {
    const chunk = fieldRefs.slice(i, i + FIELD_REF_CHUNK)
    const { values } = await fvs.batchGetValues({ recordIds, fieldReferences: chunk })
    all.push(...values)
  }
  return all
}

/**
 * Fetch display names for a set of record ids, chunked at {@link NAME_CHUNK} (Postgres
 * `IN (...)` param ceiling) via `handler.getByIds` (system + custom entities, cache-backed).
 * Ids already present in `cache` are skipped. Shared by {@link hydrateRelationNames} (relation
 * targets extracted from field values) and the detail print job (the printed records' OWN
 * display names, which never appear as relation targets).
 */
export async function hydrateDisplayNames(
  handler: UnifiedCrudHandler,
  ids: RecordId[],
  cache: Map<RecordId, string>
): Promise<void> {
  const needed = ids.filter((id) => !cache.has(id))
  if (needed.length === 0) return

  for (let i = 0; i < needed.length; i += NAME_CHUNK) {
    const chunk = needed.slice(i, i + NAME_CHUNK)
    const resolved = await handler.getByIds(chunk)
    for (const [recordId, item] of Object.entries(resolved)) {
      cache.set(recordId as RecordId, item.displayName)
    }
  }
}

/**
 * Resolve relation display names for a page. Collects every related RecordId from
 * this page's relationship values, skips ones already cached, and fetches the rest
 * via {@link hydrateDisplayNames}, merging names into the job-level `nameCache`.
 */
export async function hydrateRelationNames(
  handler: UnifiedCrudHandler,
  results: TypedFieldValueResult[],
  nameCache: Map<RecordId, string>
): Promise<void> {
  const needed = new Set<RecordId>()
  for (const result of results) {
    for (const id of extractRelationRecordIds(result)) {
      if (!nameCache.has(id)) needed.add(id)
    }
  }
  await hydrateDisplayNames(handler, [...needed], nameCache)
}

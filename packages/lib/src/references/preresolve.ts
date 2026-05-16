// packages/lib/src/references/preresolve.ts

import type { RecordId } from '../resources/client'
import { collectReferenceIds } from '../tiptap'

export interface PreresolvedReferences {
  /** De-duped record ids in document order. */
  recordIds: RecordId[]
  /** Title map keyed by record id. Missing entries fall back to bare ids. */
  titles: Map<RecordId, string>
  /**
   * Inline renderer to pass into `docToText({ references })` or
   * `blocksToMd({ references })`. Returns `[Title](id)` when a title is
   * resolved, `[reference](id)` otherwise.
   */
  render: (id: string) => string
}

/**
 * Walk the doc, fetch titles for each unique reference in one batch, and
 * return an inline renderer the caller hands to `docToText` / `blocksToMd`.
 * The `resolveTitles` callback is supplied by the caller because record-
 * title shape varies per resource (agent.name vs article.title vs
 * contact.firstName/lastName etc.) — keeping the lookup pluggable avoids
 * dragging the resource layer into this module.
 */
export async function preresolveReferences(
  doc: unknown,
  resolveTitles: (recordIds: RecordId[]) => Promise<Map<RecordId, string>>
): Promise<PreresolvedReferences> {
  const recordIds = collectReferenceIds(doc)
  const titles =
    recordIds.length === 0 ? new Map<RecordId, string>() : await resolveTitles(recordIds)
  const render = (id: string): string => {
    const title = titles.get(id as RecordId)
    if (title && title.length > 0) return `[${title}](${id})`
    return `[reference](${id})`
  }
  return { recordIds, titles, render }
}

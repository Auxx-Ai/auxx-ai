// packages/lib/src/resources/registry/record-actions-config.ts

import type { RecordActions } from './record-actions-types'

/**
 * **The single answer to "which actions does this record type offer?"**
 *
 * Previously this lived twice — `DrawerConfig.actions` and
 * `DetailViewConfig.actions` — and the two disagreed. The drawer gave every type
 * archive and delete; the detail view gave delete to `part` and `entity` only,
 * archive to `ticket`/`part`/`entity` only, and workflow-trigger to `entity`
 * only. Nothing reconciled them, so the same contact was deletable from its
 * table row and its drawer but not from its own detail page, and offered "Run
 * workflow" in the drawer but not on the page.
 *
 * Keeping one registry is the point: a surface cannot disagree with another
 * surface about a record type if there is only one place to read the answer.
 *
 * Values below are the union of the two old registries, taking the drawer's
 * answer wherever they conflicted — it was the complete one, and the detail
 * view's gaps read as unfinished rather than intentional (`contact` had neither
 * archive nor delete while carrying a Spam button that had no mutation behind
 * it).
 */
export const RECORD_ACTIONS_REGISTRY: Record<string, RecordActions> = {
  contact: { enableMerge: true, enableAddToSequence: true, enableArchive: true },
  company: { enableArchive: true },
  ticket: {
    enableEdit: true,
    enableRename: true,
    enableMerge: true,
    enableLink: true,
    enableArchive: true,
  },
  part: { enableArchive: true },
  service_request: { enableArchive: true },
  work_order: { enableArchive: true },
  quote: { enableArchive: true },
  /**
   * No `enableArchive` — invoices are ledger records and delete is the only
   * removal path. This is the one entry that makes `enableArchive` a real flag
   * rather than a constant; treat it as load-bearing.
   */
  invoice: {},
}

/**
 * Fallback for custom definitions (every one reports `entityType: 'entity'`) and
 * for any system type not listed above.
 */
export const DEFAULT_RECORD_ACTIONS: RecordActions = { enableArchive: true }

/**
 * Resolve the offered actions for a record type.
 *
 * @param entityType - ModelType from `resource.entityType`; `'entity'` for custom definitions.
 */
export function getRecordActions(entityType: string): RecordActions {
  return RECORD_ACTIONS_REGISTRY[entityType] ?? DEFAULT_RECORD_ACTIONS
}

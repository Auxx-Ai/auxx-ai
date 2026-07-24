// apps/web/src/server/api/routers/table-view-structural.ts

import type { Resource } from '@auxx/lib/resources/client'

/**
 * Pure table-view def-admin gating logic (perms v2 doc 07), no server deps so it
 * is unit-testable in isolation.
 *
 * Only two structural operations require def administration (`Full`/`admin`):
 * setting the org default view (`isDefault`) and editing the panel/dialog field
 * configs (`contextType ∈ {panel, dialog_create, dialog_edit}`). Ordinary
 * table/kanban authoring (incl. shared) stays open to read/write members —
 * `isShared` is deliberately NOT a trigger.
 */

/** Context types whose views are the def's shared panel/dialog field layouts. */
const STRUCTURAL_CONTEXT_TYPES = new Set(['panel', 'dialog_create', 'dialog_edit'])

/** Shape of a write's structural inputs (from create input or a loaded row). */
export interface StructuralViewShape {
  contextType?: string | null
  isDefault?: boolean | null
}

/**
 * Whether a write is *structural* — def administration, so def-admin gated. True
 * for panel/dialog field configs or any write that designates the org default.
 */
export function isStructural(view: StructuralViewShape): boolean {
  return (
    (view.contextType != null && STRUCTURAL_CONTEXT_TYPES.has(view.contextType)) ||
    view.isDefault === true
  )
}

/** Table/kanban views built as `entity-<defId>`; panel/dialog use a bare `<defId>`. */
export const ENTITY_TABLE_ID_PREFIX = 'entity-'

/**
 * Resolve a free-form `tableId` to the canonical `EntityDefinition.id` it belongs
 * to, given the org's resources — or `null` for non-entity surfaces
 * (workflow-runs, recordings, …) and static system types (thread, message, …)
 * that have no `EntityDefinition` row. Only entity-definition-backed resources
 * (`type: 'custom'`) carry a real `EntityDefinition.id`; system resources use a
 * slug id, so they are treated as non-entity and fall closed to org-admin at the
 * gate.
 */
export function resolveDefIdFromResources(tableId: string, resources: Resource[]): string | null {
  const key = tableId.startsWith(ENTITY_TABLE_ID_PREFIX)
    ? tableId.slice(ENTITY_TABLE_ID_PREFIX.length)
    : tableId
  const resource = resources.find((r) => r.id === key || r.entityType === key || r.apiSlug === key)
  if (!resource || resource.type !== 'custom') return null
  return resource.entityDefinitionId
}

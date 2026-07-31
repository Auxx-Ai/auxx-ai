// apps/web/src/components/records/record-action-registry.tsx
'use client'

import type { Resource } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import type { ComponentType } from 'react'
import type { RecordRowAccess } from '~/components/resources'

/**
 * Props every custom record-menu item receives. An item renders its own
 * `<DropdownMenuItem>` (or a `<DropdownMenuSub>`), so it owns its icon, label,
 * gating and dialog.
 *
 * `access` is the resolved per-ROW verdict, already folded — an item must gate
 * on this, never on a def-level `canEditEntity`, or it will disagree with every
 * built-in item sitting beside it in the same menu.
 */
export interface RecordMenuActionProps {
  recordId: RecordId
  entityDefinitionId: string
  entityInstanceId: string
  /** ModelType — `'entity'` for every custom definition. */
  entityType: string
  record?: Record<string, unknown>
  resource?: Resource
  access: RecordRowAccess
}

type Registry = Record<string, ComponentType<RecordMenuActionProps>[]>

/**
 * Custom menu items keyed by **ModelType** — the coarse tier, for behaviour that
 * belongs to every record of a system type.
 */
const BY_ENTITY_TYPE: Registry = {}

/**
 * Custom menu items keyed by **entityDefinitionId** — the precise tier.
 *
 * This tier is why the drawer's `getHeaderActions` could not simply be reused:
 * it keys on ModelType alone, and EVERY custom definition reports
 * `entityType: 'entity'`, so a Shipments-only action registered there would
 * appear on every other custom definition in the org.
 */
const BY_DEFINITION_ID: Registry = {}

/**
 * Resolve the custom menu items for a record. The per-definition tier WINS
 * outright rather than concatenating: a definition that registers items is
 * stating what it wants, and a silent union with the type-level list is the kind
 * of thing nobody can predict from the call site.
 *
 * Both maps start empty — this is the extension point the detail view never had
 * (`detail-view-config.ts` notes "no per-entity extension point exists yet"),
 * not a migration of anything. Note the drawer's `drawer-action-registry.tsx`
 * stays where it is and is NOT superseded: it registers primary header BUTTONS
 * (Compose, Reply, Schedule) that belong outside a menu, the same tier as the
 * favourite star.
 */
export function getRecordMenuActions(
  entityType: string,
  entityDefinitionId?: string
): ComponentType<RecordMenuActionProps>[] {
  if (entityDefinitionId && BY_DEFINITION_ID[entityDefinitionId]) {
    return BY_DEFINITION_ID[entityDefinitionId]
  }
  return BY_ENTITY_TYPE[entityType] ?? []
}

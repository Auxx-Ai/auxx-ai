// apps/web/src/components/data-connectors/lib/connector-target-projection.ts
// Pure projection of a connector DRAFT mapping's POTENTIAL target (05e —
// connector-target-resources-splice). At setup a lazily-provisioned owned def doesn't
// exist yet, so nothing in the DB or the global resource store can resolve it — the
// persisted `targetSpec` + per-entry `provision` specs are the only source. These
// builders turn that spec into the same display shapes the global resource hooks return,
// so the mapping editor can render "Shopify Orders (will create)" + "Order Name" before
// the def materializes. See plans/data-connectors/v5/connector-target-resources-splice-plan.md.

import type { FieldType } from '@auxx/database/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { DraftMapping } from '../stores/connector-draft-store'

/** A potential (not-yet-created) owned def projected from a lazy mapping's targetSpec. */
export interface ProjectedResource {
  /** Real def id, or null for a not-yet-created (potential) owned def. */
  id: string | null
  /** Singular display label. */
  label: string
  plural: string
  icon: string
  /** True ⇒ a POTENTIAL owned def the connector will create at finish/first sync. */
  willCreate: boolean
}

/** Stable provision key an entry carries — `appFieldKey` falls back to the display name. */
export function provisionKey(p: { appFieldKey?: string; name: string }): string {
  return p.appFieldKey ?? p.name
}

/**
 * Synthetic local ref for a provisioned field that has no concrete `ResourceFieldId`
 * yet (its column is created at materialize). Used only inside the connector editor to
 * key a leaf chip → its provision NAME; never persisted or sent to the server.
 */
export function potentialFieldRef(appFieldKey: string): string {
  return `@potential:${appFieldKey}`
}

/**
 * Project a lazy mapping's POTENTIAL owned def from its persisted `targetSpec`. Returns
 * null when the mapping already carries a real def (resolve via the global store) or has
 * no owned-def spec (contributing / untargeted).
 */
export function projectPotentialResource(
  mapping: Pick<DraftMapping, 'entityDefinitionId' | 'targetSpec'>
): ProjectedResource | null {
  if (mapping.entityDefinitionId) return null
  const owned = mapping.targetSpec?.ownedDef
  if (!owned) return null
  return {
    id: null,
    label: owned.singular,
    plural: owned.plural,
    icon: owned.icon ?? 'box',
    willCreate: true,
  }
}

/**
 * Synthetic `ResourceField` list for a lazy mapping's provision entries — the columns
 * that will be created at materialize. Shaped enough for the editor's label/icon/type
 * reads, keyed by a `@potential:` ref so a leaf chip resolves the provision NAME before
 * the concrete field exists. Cast to `ResourceField`: call-sites read only `id`,
 * `resourceFieldId`, `label`, and `fieldType`.
 */
export function projectProvisionFields(
  mapping: Pick<DraftMapping, 'fieldMappings'>
): ResourceField[] {
  const fields: ResourceField[] = []
  for (const fm of mapping.fieldMappings) {
    if (!fm.provision || fm.targetFieldRef != null) continue
    const key = provisionKey(fm.provision)
    fields.push({
      id: key,
      resourceFieldId: potentialFieldRef(key),
      label: fm.provision.name,
      name: fm.provision.name,
      fieldType: fm.provision.type as FieldType,
      active: true,
      // A provisioned column the connector will create — fully writable by the sync,
      // so it passes the target picker's `isWritableTarget` capability gate.
      capabilities: { creatable: true, updatable: true, computed: false },
    } as unknown as ResourceField)
  }
  return fields
}

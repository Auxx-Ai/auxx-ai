// apps/web/src/components/data-connectors/hooks/use-target-defs.ts
'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** A target field offered to mappings (id/key/label/type + identifier hint). */
export interface TargetField {
  id: string
  key: string
  label: string
  type: string
  isIdentifier: boolean
}

/** A target entity definition a mapping can land in (system or custom def). */
export interface TargetDef {
  entityDefinitionId: string
  label: string
  icon: string
  color: string
  fields: TargetField[]
}

/**
 * Lists the org's entity definitions (system contact/ticket + custom defs) and
 * their fields for the mapping target combobox + value-row field pickers. Reads
 * the cached `resource.list` query (org cache) rather than a fresh DB query.
 */
export function useTargetDefs() {
  const resources = api.resource.list.useQuery()

  const defs = useMemo<TargetDef[]>(() => {
    const rows = resources.data ?? []
    // Only EntityDefinition-backed resources are valid sink targets: their
    // `entityDefinitionId` is a real `EntityDefinition.id` (the column the mapping
    // FKs to) and they store records as EntityInstances. Old static system types
    // (thread, user, …) surface as `type: 'system'` with the type slug as their
    // `entityDefinitionId` and live in their own legacy tables — not EntityInstances —
    // so a mapping can neither FK to them nor write into them.
    return rows
      .filter((r) => r.type === 'custom')
      .map((r) => ({
        entityDefinitionId: r.entityDefinitionId,
        label: r.label,
        icon: r.icon,
        color: r.color,
        fields: (r.fields ?? []).map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: String(f.fieldType ?? f.type),
          isIdentifier: f.isIdentifier === true,
        })),
      }))
  }, [resources.data])

  const byId = useMemo(() => {
    const map = new Map<string, TargetDef>()
    for (const d of defs) map.set(d.entityDefinitionId, d)
    return map
  }, [defs])

  return { defs, byId, isLoading: resources.isLoading }
}

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
    return rows.map((r) => ({
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

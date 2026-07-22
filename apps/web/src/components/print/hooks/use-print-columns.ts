// apps/web/src/components/print/hooks/use-print-columns.ts

'use client'

import type { ExportColumn } from '@auxx/lib/export/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  isFieldPath,
  isResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import { useCallback, useMemo, useState } from 'react'
import { useExportColumns } from '~/components/data-export/hooks/use-export-columns'
import { useFields } from '~/components/resources/hooks/use-field'

/** Stable identity for a `FieldReference` — a direct id or a joined path. */
export function refKey(ref: FieldReference): string {
  return Array.isArray(ref) ? ref.join('.') : ref
}

/** Stable identity for an `ExportColumn`. */
export function columnKey(column: ExportColumn): string {
  return refKey(column.fieldRef)
}

export interface UsePrintColumnsResult {
  /** Selected columns, in print order — labels resolved (path hops joined with ›). */
  selected: ExportColumn[]
  /** Direct refs already selected — the field picker's exclude list. */
  excludeFields: ResourceFieldId[]
  /** Per-hop resolved fields — for breadcrumb labels and field-type icons. */
  hopFields: Map<string, ResourceField>
  /** Add a field-picker selection (direct or drilled path). No-op if already selected. */
  addField: (ref: FieldReference) => void
  removeColumn: (column: ExportColumn) => void
  /** Reorder `selected` — receives the full new key order (see `SortableList`). */
  reorder: (keys: string[]) => void
}

/**
 * Print wizard "Content" page column state (list/detail styles). Seeded from
 * {@link useExportColumns} exactly like the CSV export flow — `viewColumns` preselected —
 * but open-ended: any `FieldReference` the field picker produces (including drilled
 * relationship paths) can be added. Labels prefer what the table already resolved
 * (per-view overrides); refs the view doesn't know fall back to field metadata,
 * resolved per hop via `useFields` (columns-row.tsx recipe).
 */
export function usePrintColumns(
  tableId: string,
  entityDefinitionId: string | undefined
): UsePrintColumnsResult {
  const { viewColumns, allColumns } = useExportColumns(tableId, entityDefinitionId)

  // Labels the table already resolved — view label overrides win over field metadata.
  const knownLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const column of [...viewColumns, ...allColumns]) {
      if (!map.has(columnKey(column))) map.set(columnKey(column), column.label)
    }
    return map
  }, [viewColumns, allColumns])

  const [selectedRefs, setSelectedRefs] = useState<FieldReference[]>(() =>
    viewColumns.map((c) => c.fieldRef)
  )

  // Every hop of every selected ref in one shallow-compared subscription, so newly
  // drilled paths (and their breadcrumb segments/icons) resolve without per-row hooks.
  const allHops = useMemo(() => {
    const seen = new Set<ResourceFieldId>()
    for (const ref of selectedRefs) {
      for (const hop of isFieldPath(ref) ? ref : [ref]) {
        if (isResourceFieldId(hop)) seen.add(hop)
      }
    }
    return [...seen]
  }, [selectedRefs])
  const hopFieldList = useFields(allHops)
  const hopFields = useMemo(() => {
    const map = new Map<string, ResourceField>()
    allHops.forEach((hop, i) => {
      const field = hopFieldList[i]
      if (field) map.set(hop, field)
    })
    return map
  }, [allHops, hopFieldList])

  const selected = useMemo<ExportColumn[]>(
    () =>
      selectedRefs.map((ref) => ({
        label:
          knownLabels.get(refKey(ref)) ??
          (isFieldPath(ref)
            ? ref.map((hop) => hopFields.get(hop)?.label ?? hop).join(' › ')
            : (hopFields.get(ref)?.label ?? ref)),
        fieldRef: ref,
      })),
    [selectedRefs, knownLabels, hopFields]
  )

  const excludeFields = useMemo(
    () => selectedRefs.filter((ref): ref is ResourceFieldId => !isFieldPath(ref)),
    [selectedRefs]
  )

  const addField = useCallback((ref: FieldReference) => {
    setSelectedRefs((prev) => (prev.some((r) => refKey(r) === refKey(ref)) ? prev : [...prev, ref]))
  }, [])

  const removeColumn = useCallback((column: ExportColumn) => {
    setSelectedRefs((prev) => prev.filter((ref) => refKey(ref) !== columnKey(column)))
  }, [])

  const reorder = useCallback((keys: string[]) => {
    setSelectedRefs((prev) => {
      const byKey = new Map(prev.map((ref) => [refKey(ref), ref] as const))
      const next = keys
        .map((key) => byKey.get(key))
        .filter((ref): ref is FieldReference => ref !== undefined)
      return next.length === prev.length ? next : prev
    })
  }, [])

  return { selected, excludeFields, hopFields, addField, removeColumn, reorder }
}

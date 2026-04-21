// apps/web/src/components/editor/placeholders/catalog.ts

'use client'

import { tryParsePlaceholderId } from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { isFieldPath } from '@auxx/types/field'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useResourceStore } from '~/components/resources/store/resource-store'

const DATE_SLUG_LABELS: Record<string, string> = {
  today: 'Today',
  now: 'Now',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
}

/** Stable module-level empty array — reused so shallow-equality holds across renders. */
const EMPTY_FIELDS: (ResourceField | undefined)[] = []

export interface PlaceholderLabel {
  /** Human breadcrumb — e.g. "Contact › Company › Name". */
  breadcrumb: string
  /** True when every segment was found in the resource store. */
  resolved: boolean
}

const UNKNOWN: PlaceholderLabel = { breadcrumb: 'Unknown placeholder', resolved: false }

/**
 * Subscribe to the human label for a placeholder token id.
 * Re-renders only when the underlying fields (or entity labels) change.
 *
 * - `date:<slug>` → "Date › Today", etc.
 * - ResourceFieldId → "<EntityLabel> › <FieldLabel>"
 * - FieldPath → "<Root> › <Mid1> › … › <Target>"
 *
 * Returns `resolved: false` if any segment is missing — caller should show
 * a warning variant (destructive badge).
 *
 * Two selectors used instead of one: zustand's `shallow` compares top-level
 * values with `Object.is`, so an array nested inside an object is never equal
 * across snapshots and would trigger an infinite render loop. Top-level array
 * is handled element-wise by `shallow`.
 */
export function usePlaceholderLabel(id: string): PlaceholderLabel {
  const parsed = useMemo(() => tryParsePlaceholderId(id), [id])

  const ids: ResourceFieldId[] = useMemo(() => {
    if (!parsed || parsed.kind !== 'field') return []
    return isFieldPath(parsed.fieldRef) ? [...parsed.fieldRef] : [parsed.fieldRef]
  }, [parsed])

  const rootLabel = useResourceStore((state) => {
    if (!parsed) return null
    if (parsed.kind === 'date') return 'Date'
    const res = state.getEffectiveResource(parsed.rootEntityDefinitionId)
    return res?.label ?? parsed.rootEntityDefinitionId
  })

  const fields = useResourceStore(
    useShallow((state) => {
      if (!parsed || parsed.kind !== 'field') return EMPTY_FIELDS
      return ids.map((rfId) => state.fieldMap[rfId])
    })
  )

  return useMemo(() => {
    if (!parsed) return UNKNOWN
    if (parsed.kind === 'date') {
      const label = DATE_SLUG_LABELS[parsed.slug]
      return { breadcrumb: `Date › ${label ?? parsed.slug}`, resolved: !!label }
    }
    if (rootLabel == null) return UNKNOWN
    const segments = [rootLabel]
    let resolved = true
    for (const field of fields) {
      if (!field) {
        resolved = false
        continue
      }
      segments.push(field.label)
    }
    return { breadcrumb: segments.join(' › '), resolved }
  }, [parsed, rootLabel, fields])
}

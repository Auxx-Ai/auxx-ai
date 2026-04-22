// apps/web/src/components/editor/placeholders/catalog.ts

'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import {
  type FallbackSupportedType,
  isFallbackSupportedType,
  type OrgSlug,
  tryParsePlaceholderId,
} from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import { isFieldPath } from '@auxx/types/field'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useResourceProperty } from '~/components/resources'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { shimFieldForOrg } from './field-shim'

const DATE_SLUG_LABELS: Record<string, string> = {
  today: 'Today',
  now: 'Now',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
}

const ORG_SLUG_LABELS: Record<OrgSlug, string> = {
  name: 'Name',
  handle: 'Handle',
  website: 'Website',
}

const ORG_SLUG_FIELD_TYPES: Record<OrgSlug, FallbackSupportedType> = {
  name: 'TEXT',
  handle: 'TEXT',
  website: 'URL',
}

/** Stable module-level empty array — reused so shallow-equality holds across renders. */
const EMPTY_FIELDS: (ResourceField | undefined)[] = []

export interface PlaceholderLabel {
  /** Human breadcrumb — e.g. "Contact › Company › Name". */
  breadcrumb: string
  /** True when every segment was found in the resource store. */
  resolved: boolean
  /** EntityIcon `iconId` for the badge. */
  iconId: string
  /** Optional color — only set for relationship-terminal fields. */
  iconColor?: string
  /** Terminal field for fallback editing. `null` when no fallback UI applies (dates). */
  field: ResourceField | null
  /** Effective field type of the terminal field, when known. */
  fieldType: FallbackSupportedType | null
  /** True when the terminal field type supports a fallback editor. */
  fallbackSupported: boolean
}

const UNKNOWN: PlaceholderLabel = {
  breadcrumb: 'Unknown placeholder',
  resolved: false,
  iconId: 'alert-triangle',
  field: null,
  fieldType: null,
  fallbackSupported: false,
}

/**
 * Resolve the effective `FieldType` for a resource field.
 *
 * Custom fields carry `fieldType` explicitly; system fields only have a
 * workflow-engine `type` and need the base-type mapping.
 */
function resolveFieldType(field: ResourceField): FieldType | null {
  if (field.fieldType) return field.fieldType
  if (field.type) return mapBaseTypeToFieldType(field.type as any) ?? null
  return null
}

/**
 * Subscribe to the human label + icon + terminal field for a placeholder
 * token id. Re-renders only when the underlying fields (or entity labels)
 * change.
 *
 * - `date:<slug>` → "Date › Today", etc.
 * - `org:<slug>`  → "Organization › Name", etc.
 * - ResourceFieldId → "<EntityLabel> › <FieldLabel>"
 * - FieldPath → "<Root> › <Mid1> › … › <Target>"
 *
 * Returns `resolved: false` if any segment is missing — caller should show
 * a warning variant (destructive badge).
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
    if (parsed.kind === 'org') return 'Organization'
    const res = state.getEffectiveResource(parsed.rootEntityDefinitionId)
    return res?.label ?? parsed.rootEntityDefinitionId
  })

  const fields = useResourceStore(
    useShallow((state) => {
      if (!parsed || parsed.kind !== 'field') return EMPTY_FIELDS
      return ids.map((rfId) => state.fieldMap[rfId])
    })
  )

  // Terminal field (for fallback editing + relationship icon lookup)
  const terminalField = fields.length > 0 ? fields[fields.length - 1] : null

  // If the terminal field is a relationship, look up the target entity's
  // icon + color the same way FieldItem does.
  const relatedEntityDefinitionId = useMemo(() => {
    if (!terminalField?.relationship) return null
    return getRelatedEntityDefinitionId(terminalField.relationship as RelationshipConfig)
  }, [terminalField])
  const targetResourceProps = useResourceProperty(relatedEntityDefinitionId, ['icon', 'color'])

  return useMemo(() => {
    if (!parsed) return UNKNOWN

    if (parsed.kind === 'date') {
      const label = DATE_SLUG_LABELS[parsed.slug]
      return {
        breadcrumb: `Date › ${label ?? parsed.slug}`,
        resolved: !!label,
        iconId: 'calendar',
        field: null,
        fieldType: null,
        fallbackSupported: false,
      }
    }

    if (parsed.kind === 'org') {
      const label = ORG_SLUG_LABELS[parsed.slug]
      const shim = shimFieldForOrg(parsed.slug)
      const fieldType = ORG_SLUG_FIELD_TYPES[parsed.slug]
      return {
        breadcrumb: `Organization › ${label}`,
        resolved: true,
        iconId: fieldTypeOptions[fieldType]?.iconId ?? 'text',
        field: shim,
        fieldType,
        fallbackSupported: true,
      }
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

    // Icon resolution for field tokens.
    let iconId = 'circle'
    let iconColor: string | undefined
    let fieldType: FallbackSupportedType | null = null
    let fallbackSupported = false

    if (terminalField) {
      if (terminalField.relationship && targetResourceProps) {
        iconId = targetResourceProps.icon ?? 'circle'
        iconColor = targetResourceProps.color
      } else {
        const effective = resolveFieldType(terminalField)
        if (effective) {
          iconId = fieldTypeOptions[effective]?.iconId ?? 'circle'
          if (isFallbackSupportedType(effective)) {
            fieldType = effective
            fallbackSupported = true
          }
        }
      }
    }

    return {
      breadcrumb: segments.join(' › '),
      resolved,
      iconId: resolved ? iconId : 'alert-triangle',
      iconColor,
      field: terminalField ?? null,
      fieldType,
      fallbackSupported: resolved && fallbackSupported,
    }
  }, [parsed, rootLabel, fields, terminalField, targetResourceProps])
}

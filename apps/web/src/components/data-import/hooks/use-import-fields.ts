// apps/web/src/components/data-import/hooks/use-import-fields.ts

'use client'

import { useMemo } from 'react'
import { useResourceFields } from '~/components/resources'
import type { ImportableField, FieldGroup } from '@auxx/lib/import'

/** Options for useImportFields hook */
interface UseImportFieldsOptions {
  /** Include identifier fields (id, externalId) for update operations */
  includeIdentifiers?: boolean
  /** Include relationship fields for linking to other resources */
  includeRelationships?: boolean
}

/** Result of useImportFields hook */
interface UseImportFieldsResult {
  /** All importable fields with group metadata */
  fields: ImportableField[]
  /** Loading state */
  isLoading: boolean
  /** Fields grouped by their group property */
  groupedFields: Record<FieldGroup, ImportableField[]>
}

/**
 * Hook for getting importable fields from preloaded resources.
 * Uses ResourceProvider data to avoid API calls.
 *
 * @param resourceId - Resource ID to get fields for
 * @param options - Options to customize which fields are included
 * @returns Importable fields with group metadata
 */
export function useImportFields(
  resourceId: string | null,
  options: UseImportFieldsOptions = {}
): UseImportFieldsResult {
  const { includeIdentifiers = false, includeRelationships = true } = options
  const { fields, isLoading } = useResourceFields(resourceId)

  const importableFields = useMemo(() => {
    if (!fields.length) return []

    const result: ImportableField[] = []

    // 1. Add identifier fields if requested
    if (includeIdentifiers) {
      const identifiers = fields
        .filter((f) => {
          if (!f.capabilities?.filterable) return false
          if (f.relationship) return false
          return ['id', 'externalId'].includes(f.key)
        })
        .map((f) => ({
          key: f.key,
          id: f.id,
          label: f.key === 'id' ? 'Record ID' : f.label,
          type: f.type,
          required: false,
          isRelation: false,
          isIdentifier: true,
          group: 'identifier' as const,
        }))
      result.push(...identifiers)
    }

    // 2. Add creatable scalar fields
    const scalarFields = fields
      .filter((f) => f.capabilities?.creatable && !f.relationship)
      .map((f) => ({
        key: f.key,
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.capabilities?.required ?? false,
        isRelation: false,
        isIdentifier: false,
        group: (f.id ? 'custom' : 'system') as FieldGroup,
        enumValues: f.enumValues,
      }))
    result.push(...scalarFields)

    // 3. Add relationship fields if requested
    if (includeRelationships) {
      const relationFields = fields
        .filter((f) => f.capabilities?.creatable && f.relationship)
        .map((f) => ({
          key: f.key,
          id: f.id,
          label: f.label,
          type: f.type,
          required: f.capabilities?.required ?? false,
          isRelation: true,
          isIdentifier: false,
          group: 'relationship' as FieldGroup,
          relationConfig: {
            relatedEntityDefinitionId: f.relationship!.relatedEntityDefinitionId,
            relationshipType: f.relationship!.relationshipType,
          },
        }))
      result.push(...relationFields)
    }

    return result
  }, [fields, includeIdentifiers, includeRelationships])

  const groupedFields = useMemo(() => {
    const groups: Record<FieldGroup, ImportableField[]> = {
      identifier: [],
      system: [],
      custom: [],
      relationship: [],
    }

    for (const field of importableFields) {
      groups[field.group].push(field)
    }

    return groups
  }, [importableFields])

  return {
    fields: importableFields,
    isLoading,
    groupedFields,
  }
}

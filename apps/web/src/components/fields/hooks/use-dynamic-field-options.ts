// apps/web/src/components/fields/hooks/use-dynamic-field-options.ts

import { useMemo } from 'react'
import type { ResourceField } from '@auxx/lib/resources/client'
import {
  getDynamicOptionsEntry,
  type DynamicOption,
  DYNAMIC_OPTIONS_REGISTRY,
} from '../registries/dynamic-options-registry'

/**
 * Hook to fetch dynamic options for a single field.
 * Returns options array if field has dynamicOptionsKey, otherwise undefined.
 */
export function useFieldDynamicOptions(field: ResourceField | undefined): {
  options: DynamicOption[] | undefined
  isLoading: boolean
} {
  const key = field?.dynamicOptionsKey

  // Get registry entry (stable reference)
  const entry = useMemo(() => (key ? getDynamicOptionsEntry(key) : undefined), [key])

  // Call the hook (must be called unconditionally)
  const result = entry?.useOptions(true) ?? { data: undefined, isLoading: false }

  return {
    options: result.data,
    isLoading: result.isLoading,
  }
}

/**
 * Hook to enrich fields with dynamic options.
 * Replaces the old useDynamicFieldOptions hook.
 *
 * NOTE: This is a compatibility layer. In the new architecture,
 * options are loaded per-field in PropertyRow via useFieldDynamicOptions.
 */
export function useDynamicFieldOptions(fields: ResourceField[]): {
  fields: ResourceField[]
  isLoading: boolean
  error: any
} {
  // Extract unique dynamicOptionsKeys
  const keys = useMemo(() => {
    const keySet = new Set<string>()
    for (const field of fields) {
      if (field.dynamicOptionsKey) {
        keySet.add(field.dynamicOptionsKey)
      }
    }
    return Array.from(keySet)
  }, [fields])

  // Call hooks for each key (must be unconditional)
  // This is a workaround - proper implementation loads per-field
  const contactGroups = DYNAMIC_OPTIONS_REGISTRY.contactGroups?.useOptions(
    keys.includes('contactGroups')
  ) ?? {
    data: undefined,
    isLoading: false,
  }
  const teamMembers = DYNAMIC_OPTIONS_REGISTRY.teamMembers?.useOptions(
    keys.includes('teamMembers')
  ) ?? {
    data: undefined,
    isLoading: false,
  }
  const contacts = DYNAMIC_OPTIONS_REGISTRY.contacts?.useOptions(keys.includes('contacts')) ?? {
    data: undefined,
    isLoading: false,
  }
  const integrations = DYNAMIC_OPTIONS_REGISTRY.integrations?.useOptions(
    keys.includes('integrations')
  ) ?? {
    data: undefined,
    isLoading: false,
  }
  const inboxes = DYNAMIC_OPTIONS_REGISTRY.inboxes?.useOptions(keys.includes('inboxes')) ?? {
    data: undefined,
    isLoading: false,
  }
  const tags = DYNAMIC_OPTIONS_REGISTRY.tags?.useOptions(keys.includes('tags')) ?? {
    data: undefined,
    isLoading: false,
  }

  // Build options map
  const optionsMap = useMemo(() => {
    const map: Record<string, DynamicOption[] | undefined> = {
      contactGroups: contactGroups?.data,
      teamMembers: teamMembers?.data,
      contacts: contacts?.data,
      integrations: integrations?.data,
      inboxes: inboxes?.data,
      tags: tags?.data,
    }
    return map
  }, [
    contactGroups?.data,
    teamMembers?.data,
    contacts?.data,
    integrations?.data,
    inboxes?.data,
    tags?.data,
  ])

  // Enrich fields with options
  const enrichedFields = useMemo(() => {
    return fields.map((field) => {
      if (field.dynamicOptionsKey) {
        const options = optionsMap[field.dynamicOptionsKey]
        if (options) {
          return {
            ...field,
            options: {
              ...field.options,
              options: options.map((o) => ({ value: o.value, label: o.label, color: o.color })),
            },
          }
        }
      }
      return field
    })
  }, [fields, optionsMap])

  const isLoading = [contactGroups, teamMembers, contacts, integrations, inboxes, tags].some(
    (r) => r?.isLoading
  )

  return { fields: enrichedFields, isLoading, error: null }
}

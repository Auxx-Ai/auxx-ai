// apps/web/src/components/fields/hooks/use-dynamic-field-options.ts
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { ModelTypes, type ModelType } from '@auxx/types/custom-field'
import type { BuiltInFieldDefinition } from '../configs/model-field-configs'

/**
 * Query registry entry
 */
interface QueryRegistryEntry {
  key: string
  hook: (enabled: boolean) => {
    data: any
    isLoading: boolean
    error: any
  }
  models: ModelType[]
}

/**
 * Registry of all possible dynamic option queries
 * Maps query keys to their hook calls and applicable models
 *
 * To add a new query:
 * 1. Add entry to this registry
 * 2. Define the query in field config's dynamicOptions
 */
const QUERY_REGISTRY: QueryRegistryEntry[] = [
  {
    key: 'contact.getGroups',
    hook: (enabled: boolean) => api.contact.getGroups.useQuery({}, { enabled }),
    models: [ModelTypes.CONTACT],
  },
  {
    key: 'user.teamMembers',
    hook: (enabled: boolean) => api.user.teamMembers.useQuery(undefined, { enabled }),
    models: [ModelTypes.TICKET, ModelTypes.THREAD],
  },
  {
    key: 'contact.getAll',
    hook: (enabled: boolean) =>
      api.contact.getAll.useQuery({ limit: 100, page: 1 }, { enabled }),
    models: [ModelTypes.TICKET],
  },
  {
    key: 'integration.getIntegrations',
    hook: (enabled: boolean) => api.integration.getIntegrations.useQuery(undefined, { enabled }),
    models: [ModelTypes.THREAD],
  },
  {
    key: 'tag.getAll',
    hook: (enabled: boolean) => api.tag.getAll.useQuery({}, { enabled }),
    models: [ModelTypes.CONTACT, ModelTypes.TICKET, ModelTypes.THREAD],
  },
]

/**
 * Hook to load dynamic options for fields based on configuration
 *
 * This hook:
 * 1. Examines field configs to determine which queries are needed
 * 2. Calls ALL registered queries (following React Rules of Hooks)
 * 3. Only enables queries that are both needed and valid for the model type
 * 4. Maps query results back to fields using the configured mapFn
 * 5. Returns fields enriched with properly structured options
 *
 * @param fields - Array of built-in field definitions
 * @param modelType - The entity model type (CONTACT, TICKET, etc.)
 * @returns Object with enriched fields, loading state, and error state
 */
export function useDynamicFieldOptions(
  fields: BuiltInFieldDefinition[],
  modelType: ModelType
) {
  // Extract required query keys from field configs
  const requiredQueries = useMemo(() => {
    return new Set(fields.filter((f) => f.dynamicOptions).map((f) => f.dynamicOptions!.queryKey))
  }, [fields])

  // Call ALL queries from registry (required by Rules of Hooks)
  // Only enable queries that are both needed AND valid for this model type
  const queryResults = QUERY_REGISTRY.map(({ key, hook, models }) => {
    const shouldEnable = models.includes(modelType) && requiredQueries.has(key)
    const result = hook(shouldEnable)

    return {
      key,
      data: result.data,
      isLoading: result.isLoading,
      error: result.error,
    }
  })

  // Build data map from query results
  const dataMap = useMemo(() => {
    const map = new Map<string, any>()
    queryResults.forEach(({ key, data }) => {
      if (data) {
        map.set(key, data)
      }
    })
    return map
  }, [queryResults])

  // Enrich fields with loaded options
  const enrichedFields = useMemo(() => {
    return fields.map((field) => {
      // Handle fields with dynamic options
      if (field.dynamicOptions) {
        // Get query data for this field
        const queryData = dataMap.get(field.dynamicOptions.queryKey)
        if (!queryData) {
          return field
        }

        // Apply the field's mapFn to transform query data to options
        const optionsList = field.dynamicOptions.mapFn(queryData)

        // Return field with properly nested options structure
        // Components expect: field.options.options
        return {
          ...field,
          options: {
            options: optionsList,
          },
        }
      }

      // Handle fields with static options - wrap them in the same nested structure
      if (field.options && Array.isArray(field.options)) {
        return {
          ...field,
          options: {
            options: field.options,
          },
        }
      }

      // Return field unchanged if no options
      return field
    })
  }, [fields, dataMap])

  // Aggregate loading and error states
  const isLoading = queryResults.some((r) => r.isLoading)
  const error = queryResults.find((r) => r.error)?.error

  return {
    fields: enrichedFields,
    isLoading,
    error,
  }
}

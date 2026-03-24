// apps/web/src/components/workflow/nodes/core/list/hooks/use-unique-config.ts

import type { FieldReference } from '@auxx/types/field'
import { useCallback } from 'react'
import type { FieldDefinition } from '~/components/conditions'
import type { ListNodeData, UniqueBy } from '../types'

/**
 * Hook to manage unique configuration for the List node.
 */
export function useUniqueConfig(
  nodeData: ListNodeData,
  setNodeData: (data: Partial<ListNodeData>) => void
) {
  const config = nodeData.uniqueConfig

  const handleByChange = useCallback(
    (by: UniqueBy) => {
      setNodeData({
        uniqueConfig: {
          ...config,
          by,
          // Clear field when switching to 'whole'
          field: by === 'whole' ? undefined : config?.field,
          keepFirst: config?.keepFirst ?? true,
          caseSensitive: config?.caseSensitive ?? true,
        },
      })
    },
    [config, setNodeData]
  )

  const handleFieldChange = useCallback(
    (field: string | undefined) => {
      if (!config) return
      setNodeData({
        uniqueConfig: {
          ...config,
          field,
        },
      })
    },
    [config, setNodeData]
  )

  /** Handle field selection from NavigableFieldSelector */
  const handleFieldSelect = useCallback(
    (fieldReference: FieldReference, _fieldDef: FieldDefinition) => {
      setNodeData({
        uniqueConfig: {
          ...config,
          by: 'field',
          field: fieldReference as string | string[],
          keepFirst: config?.keepFirst ?? true,
          caseSensitive: config?.caseSensitive ?? true,
        },
      })
    },
    [config, setNodeData]
  )

  const handleKeepFirstChange = useCallback(
    (keepFirst: boolean) => {
      if (!config) return
      setNodeData({
        uniqueConfig: {
          ...config,
          keepFirst,
        },
      })
    },
    [config, setNodeData]
  )

  const handleCaseSensitiveChange = useCallback(
    (caseSensitive: boolean) => {
      if (!config) return
      setNodeData({
        uniqueConfig: {
          ...config,
          caseSensitive,
        },
      })
    },
    [config, setNodeData]
  )

  return {
    by: config?.by ?? 'whole',
    field: config?.field,
    keepFirst: config?.keepFirst ?? true,
    caseSensitive: config?.caseSensitive ?? true,
    handleByChange,
    handleFieldChange,
    handleFieldSelect,
    handleKeepFirstChange,
    handleCaseSensitiveChange,
  }
}

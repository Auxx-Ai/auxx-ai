// apps/web/src/components/workflow/nodes/core/text-classifier/text-classifier-context.tsx

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useUpdateNodeInternals } from '@xyflow/react'
import { produce } from 'immer'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useEdgeInteractions } from '~/components/workflow/hooks'
import { DEFAULT_CATEGORY_PREFIX } from './constants'
import type {
  Category,
  ModelConfig,
  TextClassifierNodeData,
  TextClassifierOutputMode,
} from './types'

/**
 * Context value interface for text classifier
 */
interface TextClassifierContextValue {
  // State
  config: TextClassifierNodeData // Using flattened data structure but keeping name for backward compatibility
  isReadOnly: boolean
  nodeId: string
  // Actions
  updateTitle: (title: string) => void
  updateDescription: (desc: string) => void
  updateModel: (model: ModelConfig) => void
  updateText: (text: string) => void

  // Category management
  addCategory: () => void
  updateCategory: (id: string, updates: Partial<Category>) => void
  deleteCategory: (id: string) => void

  // Advanced settings
  updateVision: (enabled: boolean) => void
  updateInstruction: (enabled: boolean, text?: string) => void
  updateOutputMode: (mode: TextClassifierOutputMode) => void

  // Utilities
  // preprocessPrompt: (editorContent: string) => { text: string; variables: string[] }
}

const TextClassifierContext = createContext<TextClassifierContextValue | null>(null)

/**
 * Props for TextClassifierProvider
 */
interface TextClassifierProviderProps {
  children: React.ReactNode
  nodeId: string
  data: TextClassifierNodeData
  setData: (data: TextClassifierNodeData) => void
  readOnly?: boolean
}

/**
 * Provider component for text classifier context
 */
export const TextClassifierProvider: React.FC<TextClassifierProviderProps> = ({
  children,
  nodeId,
  data,
  setData,
  readOnly = false,
}) => {
  // Get edge deletion handler
  const { handleEdgeDeleteByDeleteBranch } = useEdgeInteractions()
  const updateNodeInternals = useUpdateNodeInternals()

  // Helper function to update _targetBranches based on categories and outputMode
  const updateTargetBranches = (draft: TextClassifierNodeData) => {
    if (draft.outputMode === 'variable') {
      draft._targetBranches = [{ id: 'source', name: '', type: 'default' as const }]
    } else {
      draft._targetBranches = [
        ...draft.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          type: 'default' as const,
        })),
        { id: 'unmatched', name: 'Unmatched', type: 'default' as const },
      ]
    }
  }

  // Single update function using Immer for all updates
  const updateConfig = useCallback(
    (updater: (draft: TextClassifierNodeData) => void) => {
      const newData = produce(data, updater)
      setData(newData)
    },
    [data, setData]
  )

  // Update title
  const updateTitle = useCallback(
    (title: string) => {
      updateConfig((draft) => {
        draft.title = title
      })
    },
    [updateConfig]
  )

  // Update description
  const updateDescription = useCallback(
    (desc: string) => {
      updateConfig((draft) => {
        draft.desc = desc
      })
    },
    [updateConfig]
  )

  // Update model configuration
  const updateModel = useCallback(
    (model: ModelConfig) => {
      updateConfig((draft) => {
        draft.model = model
      })
    },
    [updateConfig]
  )

  // Update text to classify
  const updateText = useCallback(
    (text: string) => {
      updateConfig((draft) => {
        draft.text = text
      })
    },
    [updateConfig]
  )

  // Add new category
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateTargetBranches is a local helper, not a reactive dependency
  const addCategory = useCallback(() => {
    updateConfig((draft) => {
      draft.categories.push({
        id: generateId(),
        name: `${DEFAULT_CATEGORY_PREFIX} ${draft.categories.length + 1}`,
        description: '',
        text: '',
      })
      // Update _targetBranches after adding category
      updateTargetBranches(draft)
    })
    updateNodeInternals(nodeId) // Ensure React Flow updates the node
  }, [updateConfig, nodeId, updateNodeInternals])

  // Update existing category
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateTargetBranches is a local helper, not a reactive dependency
  const updateCategory = useCallback(
    (id: string, updates: Partial<Category>) => {
      updateConfig((draft) => {
        const category = draft.categories.find((c) => c.id === id)
        if (category) {
          Object.assign(category, updates)
          // Update _targetBranches if name changed
          if (updates.name !== undefined) {
            updateTargetBranches(draft)
          }
        }
      })
    },
    [updateConfig]
  )

  // Delete category
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateTargetBranches is a local helper, not a reactive dependency
  const deleteCategory = useCallback(
    (id: string) => {
      updateConfig((draft) => {
        draft.categories = draft.categories.filter((c) => c.id !== id)
        // Update _targetBranches after deleting category
        updateTargetBranches(draft)
      })

      // Delete any edges connected to this category handle
      handleEdgeDeleteByDeleteBranch(nodeId, id)
      updateNodeInternals(nodeId) // Ensure React Flow updates the node
    },
    [updateConfig, nodeId, handleEdgeDeleteByDeleteBranch, updateNodeInternals]
  )

  // Update vision setting
  const updateVision = useCallback(
    (enabled: boolean) => {
      updateConfig((draft) => {
        draft.vision.enabled = enabled
      })
    },
    [updateConfig]
  )

  // Update instruction setting
  const updateInstruction = useCallback(
    (enabled: boolean, text?: string) => {
      updateConfig((draft) => {
        draft.instruction.enabled = enabled
        if (text !== undefined) {
          draft.instruction.text = text
        }
      })
    },
    [updateConfig]
  )

  // Update output mode
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateTargetBranches is a local helper, not a reactive dependency
  const updateOutputMode = useCallback(
    (mode: TextClassifierOutputMode) => {
      updateConfig((draft) => {
        draft.outputMode = mode
        if (mode === 'variable') {
          draft._targetBranches = [{ id: 'source', name: '', type: 'default' as const }]
        } else {
          updateTargetBranches(draft)
        }
      })

      if (mode === 'variable') {
        const currentCategories = data.categories
        currentCategories.forEach((cat) => {
          handleEdgeDeleteByDeleteBranch(nodeId, cat.id)
        })
        handleEdgeDeleteByDeleteBranch(nodeId, 'unmatched')
      }

      updateNodeInternals(nodeId)
    },
    [updateConfig, data, nodeId, handleEdgeDeleteByDeleteBranch, updateNodeInternals]
  )

  // Memoized context value
  const contextValue = useMemo<TextClassifierContextValue>(
    () => ({
      config: data, // Using flattened data but keeping name for backward compatibility
      nodeId,
      // availableVariables: variables,
      isReadOnly: readOnly,
      updateTitle,
      updateDescription,
      updateModel,
      updateText,
      addCategory,
      updateCategory,
      deleteCategory,
      updateVision,
      updateInstruction,
      updateOutputMode,
    }),
    [
      nodeId,
      data,
      // variables,
      readOnly,
      updateTitle,
      updateDescription,
      updateModel,
      updateText,
      addCategory,
      updateCategory,
      deleteCategory,
      updateVision,
      updateInstruction,
      updateOutputMode,
    ]
  )

  return (
    <TextClassifierContext.Provider value={contextValue}>{children}</TextClassifierContext.Provider>
  )
}

/**
 * Hook to use text classifier context
 */
export const useTextClassifierContext = () => {
  const context = useContext(TextClassifierContext)
  if (!context) {
    throw new Error('useTextClassifierContext must be used within TextClassifierProvider')
  }
  return context
}

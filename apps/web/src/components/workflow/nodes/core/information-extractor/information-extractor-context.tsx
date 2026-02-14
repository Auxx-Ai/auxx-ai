// apps/web/src/components/workflow/nodes/core/information-extractor/information-extractor-context.tsx

'use client'

import type React from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useAvailableVariables } from '~/components/workflow/hooks'
import { schemaToOutputVars } from '~/components/workflow/ui/structured-output-generator/schema-to-vars'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'
import type { UnifiedVariable } from '../if-else'
import type {
  InformationExtractorContextValue,
  InformationExtractorModel,
  InformationExtractorNodeData,
} from './types'

const InformationExtractorContext = createContext<InformationExtractorContextValue | null>(null)

/**
 * Props for InformationExtractorProvider
 */
interface InformationExtractorProviderProps {
  children: React.ReactNode
  nodeId: string
  data: InformationExtractorNodeData
  onChange: (data: InformationExtractorNodeData) => void
  readOnly?: boolean
}

/**
 * Provider component for information extractor context
 */
export const InformationExtractorProvider: React.FC<InformationExtractorProviderProps> = ({
  children,
  nodeId,
  data,
  onChange,
  readOnly = false,
}) => {
  // Use the enhanced variable system
  const { variables } = useAvailableVariables({
    nodeId,
    includeEnvironment: true,
    includeSystem: true,
  })

  // Update title
  const updateTitle = useCallback(
    (title: string) => {
      onChange({ ...data, title })
    },
    [data, onChange]
  )

  // Update description
  const updateDescription = useCallback(
    (desc: string) => {
      onChange({ ...data, desc })
    },
    [data, onChange]
  )

  // Update model configuration
  const updateModel = useCallback(
    (model: InformationExtractorModel) => {
      onChange({ ...data, model })
    },
    [data, onChange]
  )

  // Update text to extract from
  const updateText = useCallback(
    (text: string) => {
      onChange({ ...data, text })
    },
    [data, onChange]
  )

  // Update structured output
  const updateStructuredOutput = useCallback(
    (enabled: boolean, newSchema?: SchemaRoot) => {
      onChange({
        ...data,
        structured_output: { enabled, schema: newSchema || data.structured_output?.schema },
      })
    },
    [data, onChange]
  )

  // Update vision setting
  const updateVision = useCallback(
    (enabled: boolean) => {
      onChange({ ...data, vision: { enabled } })
    },
    [data, onChange]
  )

  // Update instruction setting
  const updateInstruction = useCallback(
    (enabled: boolean, text?: string) => {
      onChange({
        ...data,
        instruction: { enabled, text: text !== undefined ? text : data.instruction.text },
      })
    },
    [data, onChange]
  )

  // Get output variables from schema
  const getOutputVariables = useCallback((): UnifiedVariable[] => {
    if (!data.structured_output?.schema || !data.structured_output.enabled) return []

    // Use the schemaToOutputVars utility from StructuredOutputGenerator
    const outputVars = schemaToOutputVars(data.structured_output.schema)

    // Convert OutputVariable to UnifiedVariable format
    return outputVars.map((outputVar) => ({
      id: `${nodeId}_${outputVar.name}`,
      name: outputVar.name,
      type: outputVar.type,
      // nodeId: nodeId,
      // path: outputVar.name,
      // fullPath: `${nodeId}.${outputVar.name}`,
      label: outputVar.name,
      category: 'output' as const,
      description: outputVar.description,
      ...(outputVar.subItems && { subItems: outputVar.subItems }),
    }))
  }, [data.structured_output, nodeId])

  // Create context value
  const contextValue = useMemo<InformationExtractorContextValue>(
    () => ({
      // State
      config: data, // Keep as 'config' for backward compatibility with panel
      availableVariables: variables,
      isReadOnly: readOnly,
      schema: data.structured_output?.schema,

      // Actions
      updateTitle,
      updateDescription,
      updateModel,
      updateText,
      updateStructuredOutput,

      // Advanced settings
      updateVision,
      updateInstruction,

      // Utilities
      // preprocessPrompt,
      getOutputVariables,
    }),
    [
      data,
      variables,
      readOnly,
      updateTitle,
      updateDescription,
      updateModel,
      updateText,
      updateStructuredOutput,
      updateVision,
      updateInstruction,
      // preprocessPrompt,
      getOutputVariables,
    ]
  )

  return (
    <InformationExtractorContext.Provider value={contextValue}>
      {children}
    </InformationExtractorContext.Provider>
  )
}

/**
 * Hook to use information extractor context
 */
export const useInformationExtractor = () => {
  const context = useContext(InformationExtractorContext)
  if (!context) {
    throw new Error('useInformationExtractor must be used within InformationExtractorProvider')
  }
  return context
}

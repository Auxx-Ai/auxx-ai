// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/panel.tsx

'use client'

import React, { memo, useCallback } from 'react'
import { produce } from 'immer'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { InputGroup, InputGroupAddon } from '@auxx/ui/components/input-group'
import { type KnowledgeRetrievalNodeData, type DatasetEntry } from './types'
import { BasePanel } from '../../shared/base/base-panel'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { VAR_MODE, BaseType } from '~/components/workflow/types'
import { getKnowledgeRetrievalOutputVariables } from './output-variables'

interface KnowledgeRetrievalPanelProps {
  nodeId: string
  data: KnowledgeRetrievalNodeData
}

/** Search type options */
const searchTypeOptions = [
  { label: 'Hybrid', value: 'hybrid' },
  { label: 'Vector Search', value: 'vector' },
  { label: 'Full-Text Search', value: 'text' },
]

/**
 * Knowledge Retrieval node configuration panel
 * Allows configuration of search query, datasets, and search options
 */
const KnowledgeRetrievalPanelComponent: React.FC<KnowledgeRetrievalPanelProps> = ({
  nodeId,
  data,
}) => {
  const { inputs: nodeData, setInputs } = useNodeCrud<KnowledgeRetrievalNodeData>(nodeId, data)
  const { isReadOnly } = useReadOnly()

  const datasets = nodeData.datasets || []

  /**
   * Generic handler for string field changes
   */
  const handleFieldChange = useCallback(
    (field: string, value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        ;(draft as Record<string, unknown>)[field] = value || undefined
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handler for number field changes
   */
  const handleNumberChange = useCallback(
    (field: 'limit' | 'similarityThreshold', value: unknown, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        if (modeChanged) {
          // Clear value when switching modes
          draft[field] = undefined
        } else if (isConstantMode) {
          // Constant mode: parse as number
          const numValue = typeof value === 'number' ? value : parseFloat(String(value))
          draft[field] = isNaN(numValue) ? undefined : numValue
        } else {
          // Variable mode: store as string (variable reference)
          draft[field] = value as number
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Add a new dataset entry
   */
  const handleAddDataset = useCallback(() => {
    if (isReadOnly) return

    const newData = produce(nodeData, (draft) => {
      if (!draft.datasets) draft.datasets = []
      draft.datasets.push({ datasetId: '' })
    })
    setInputs(newData)
  }, [nodeData, setInputs, isReadOnly])

  /**
   * Remove a dataset entry
   */
  const handleRemoveDataset = useCallback(
    (index: number) => {
      if (isReadOnly) return

      const newData = produce(nodeData, (draft) => {
        if (draft.datasets) {
          draft.datasets.splice(index, 1)
        }
        // Clean up field modes for removed index
        if (draft.fieldModes) {
          delete draft.fieldModes[`datasets.${index}.datasetId`]
        }
      })
      setInputs(newData)
    },
    [nodeData, setInputs, isReadOnly]
  )

  /**
   * Update a dataset entry
   */
  const handleDatasetChange = useCallback(
    (index: number, datasetId: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        if (!draft.datasets) draft.datasets = []
        if (!draft.datasets[index]) draft.datasets[index] = { datasetId: '' }
        draft.datasets[index].datasetId = datasetId || ''
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[`datasets.${index}.datasetId`] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Query Section */}
      <Section
        title="Query"
        isRequired
        initialOpen
        description="The text query to search for in datasets">
        <VarEditorField className="">
          <VarEditor
            nodeId={nodeId}
            value={nodeData.query}
            onChange={(v, m) => handleFieldChange('query', v, m)}
            varType={BaseType.STRING}
            allowedTypes={[BaseType.STRING]}
            mode={VAR_MODE.PICKER}
            placeholder="Enter search query or select variable"
            placeholderConstant="Enter search query..."
            allowConstant
            isConstantMode={nodeData.fieldModes?.['query'] ?? false}
          />
        </VarEditorField>
      </Section>

      {/* Datasets Section */}
      <Section
        title="Datasets"
        description="Select one or more datasets to search across"
        isRequired
        initialOpen
        actions={
          !isReadOnly && (
            <Button variant="ghost" size="xs" onClick={handleAddDataset}>
              <Plus /> Add
            </Button>
          )
        }>
        <div className="space-y-4">
          {datasets.length > 0 && (
            <div className="space-y-2">
              {datasets.map((entry, index) => {
                const fieldKey = `datasets.${index}.datasetId`
                const isConstantMode = nodeData.fieldModes?.[fieldKey] ?? true

                return (
                  <InputGroup key={index} className="flex items-center gap-2 ps-1 rounded-2xl">
                    <VarEditor
                      nodeId={nodeId}
                      value={entry.datasetId}
                      onChange={(v, m) => handleDatasetChange(index, v, m)}
                      varType={BaseType.RELATION}
                      fieldReference="dataset"
                      allowedTypes={['dataset' as BaseType, BaseType.STRING]}
                      mode={VAR_MODE.PICKER}
                      placeholder="Select dataset"
                      placeholderConstant="Select dataset"
                      allowConstant
                      hideClearButton
                      isConstantMode={isConstantMode}
                    />

                    {!isReadOnly && (
                      <InputGroupAddon align="inline-end">
                        <Button
                          size="icon-xs"
                          variant="destructive-hover"
                          onClick={() => handleRemoveDataset(index)}>
                          <Trash2 />
                        </Button>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                )
              })}
            </div>
          )}

          {datasets.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">
              No datasets selected. Click the + button to add datasets to search.
            </div>
          )}
        </div>
      </Section>

      {/* Search Settings Section */}
      <Section title="Search Settings" initialOpen={true}>
        <VarEditorField className="p-0">
          <VarEditorFieldRow
            title="Search Type"
            description="Strategy for searching: hybrid combines vector and text search"
            type={BaseType.ENUM}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.searchType}
              onChange={(v, m) => handleFieldChange('searchType', v, m)}
              varType={BaseType.ENUM}
              allowedTypes={[BaseType.ENUM, BaseType.STRING]}
              fieldOptions={{ enum: searchTypeOptions }}
              mode={VAR_MODE.PICKER}
              placeholder="Select search type"
              placeholderConstant="Select search type"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['searchType'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Limit"
            description="Maximum number of results to return (1-100)"
            type={BaseType.NUMBER}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.limit}
              onChange={(v, m) => handleNumberChange('limit', v, m)}
              varType={BaseType.NUMBER}
              allowedTypes={[BaseType.NUMBER]}
              mode={VAR_MODE.PICKER}
              placeholder="20"
              placeholderConstant="20"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['limit'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Similarity Threshold"
            description="Minimum similarity score for vector search (0.0-1.0)"
            type={BaseType.NUMBER}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.similarityThreshold}
              onChange={(v, m) => handleNumberChange('similarityThreshold', v, m)}
              varType={BaseType.NUMBER}
              allowedTypes={[BaseType.NUMBER]}
              mode={VAR_MODE.PICKER}
              placeholder="0.7"
              placeholderConstant="0.7"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['similarityThreshold'] ?? true}
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getKnowledgeRetrievalOutputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const KnowledgeRetrievalPanel = memo(KnowledgeRetrievalPanelComponent)

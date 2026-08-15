// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputGroup, InputGroupAddon } from '@auxx/ui/components/input-group'
import { Switch } from '@auxx/ui/components/switch'
import { produce } from 'immer'
import { BookOpen, Database, Plus, Trash2 } from 'lucide-react'
import type React from 'react'
import { memo, useCallback } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
  type VarEditorValue,
  varEditorText,
} from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { getKnowledgeRetrievalOutputVariables } from './output-variables'
import {
  type KnowledgeRetrievalNodeData,
  type KnowledgeSourceRow,
  sourceFieldKey,
  sourceRawId,
} from './types'

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

  const sources = nodeData.sources || []

  /**
   * Generic handler for string field changes
   */
  const handleFieldChange = useCallback(
    (field: string, value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        ;(draft as Record<string, unknown>)[field] = varEditorText(value) || undefined
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
    (field: 'limit' | 'similarityThreshold', value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        if (modeChanged) {
          // Clear value when switching modes
          draft[field] = undefined
        } else if (isConstantMode) {
          // Constant mode: parse as number
          const numValue = typeof value === 'number' ? value : parseFloat(String(value))
          draft[field] = Number.isNaN(numValue) ? undefined : numValue
        } else {
          // Variable mode: store the variable reference as-is
          draft[field] = varEditorText(value) || undefined
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Add a source row. Kind is chosen up front and stored — see
   * {@link KnowledgeSourceRow}.
   */
  const handleAddSource = useCallback(
    (kind: KnowledgeSourceRow['kind']) => {
      if (isReadOnly) return

      const newData = produce(nodeData, (draft) => {
        if (!draft.sources) draft.sources = []
        draft.sources.push(
          kind === 'kb' ? { kind: 'kb', knowledgeBaseId: '' } : { kind: 'dataset', datasetId: '' }
        )
      })
      setInputs(newData)
    },
    [nodeData, setInputs, isReadOnly]
  )

  /**
   * Remove a source row.
   *
   * The `fieldModes` keys are positional (`sources.<i>.…`), so removing a row
   * shifts every later row's key. Deleting only the removed index — which is
   * what this used to do — left rows after it reading the wrong mode: remove
   * row 0 of three and rows 1–2 silently inherit each other's constant/variable
   * setting. Rebuild the whole `sources.*` block instead.
   */
  const handleRemoveSource = useCallback(
    (index: number) => {
      if (isReadOnly) return

      const newData = produce(nodeData, (draft) => {
        if (!draft.sources) return
        // Capture each row's mode by its CURRENT index before the splice.
        const modes = draft.sources.map((row, i) => draft.fieldModes?.[sourceFieldKey(row, i)])

        draft.sources.splice(index, 1)
        modes.splice(index, 1)

        if (draft.fieldModes) {
          for (const key of Object.keys(draft.fieldModes)) {
            if (key.startsWith('sources.')) delete draft.fieldModes[key]
          }
        } else {
          draft.fieldModes = {}
        }
        draft.sources.forEach((row, i) => {
          const mode = modes[i]
          if (mode !== undefined) draft.fieldModes![sourceFieldKey(row, i)] = mode
        })
      })
      setInputs(newData)
    },
    [nodeData, setInputs, isReadOnly]
  )

  /**
   * Update a source row's id, keeping its stored kind.
   */
  const handleSourceChange = useCallback(
    (index: number, value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        if (!draft.sources) return
        const row = draft.sources[index]
        if (!row) return

        const id = varEditorText(value)
        if (row.kind === 'kb') {
          row.knowledgeBaseId = id
        } else {
          row.datasetId = id
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[sourceFieldKey(row, index)] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Toggle a plain boolean setting (no variable binding).
   */
  const handleToggleChange = useCallback(
    (field: 'dedupePerDocument', checked: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft[field] = checked
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = true
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Query Section */}
      <Section
        title='Query'
        isRequired
        initialOpen
        description='The text query to search for in datasets'>
        <VarEditorField className=''>
          <VarEditor
            nodeId={nodeId}
            value={nodeData.query}
            onChange={(v, m) => handleFieldChange('query', v, m)}
            varType={BaseType.STRING}
            allowedTypes={[BaseType.STRING]}
            mode={VAR_MODE.PICKER}
            placeholder='Enter search query or select variable'
            placeholderConstant='Enter search query...'
            allowConstant
            isConstantMode={nodeData.fieldModes?.['query'] ?? false}
          />
        </VarEditorField>
      </Section>

      {/* Knowledge Section */}
      <Section
        title='Knowledge'
        description='Select the knowledge bases and datasets to search across'
        isRequired
        initialOpen
        actions={
          !isReadOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='xs'>
                  <Plus /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => handleAddSource('kb')}>
                  <BookOpen /> Knowledge base
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAddSource('dataset')}>
                  <Database /> Dataset
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }>
        <div className='space-y-4'>
          {sources.length > 0 && (
            <div className='space-y-2'>
              {sources.map((row, index) => {
                const isKb = row.kind === 'kb'
                const isConstantMode = nodeData.fieldModes?.[sourceFieldKey(row, index)] ?? true

                return (
                  <InputGroup key={index} className='flex items-center gap-2 ps-1 rounded-2xl'>
                    <VarEditor
                      nodeId={nodeId}
                      value={sourceRawId(row)}
                      onChange={(v, m) => handleSourceChange(index, v, m)}
                      varType={BaseType.RELATION}
                      fieldOptions={{ fieldReference: isKb ? 'kb' : 'dataset' }}
                      allowedTypes={[(isKb ? 'kb' : 'dataset') as BaseType, BaseType.STRING]}
                      mode={VAR_MODE.PICKER}
                      placeholder={isKb ? 'Select knowledge base' : 'Select dataset'}
                      placeholderConstant={isKb ? 'Select knowledge base' : 'Select dataset'}
                      allowConstant
                      hideClearButton
                      isConstantMode={isConstantMode}
                    />

                    {!isReadOnly && (
                      <InputGroupAddon align='inline-end'>
                        <Button
                          size='icon-xs'
                          variant='destructive-hover'
                          onClick={() => handleRemoveSource(index)}>
                          <Trash2 />
                        </Button>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                )
              })}
            </div>
          )}

          {sources.length === 0 && (
            <div className='text-sm text-muted-foreground text-center py-4'>
              No knowledge selected. Use Add to search a knowledge base or a dataset.
            </div>
          )}
        </div>
      </Section>

      {/* Search Settings Section */}
      <Section title='Search Settings' initialOpen={true}>
        <VarEditorField className='p-0'>
          <VarEditorFieldRow
            title='Search Type'
            description='Strategy for searching: hybrid combines vector and text search'
            type={BaseType.ENUM}
            onClear={
              nodeData.searchType
                ? () =>
                    handleFieldChange('searchType', '', nodeData.fieldModes?.['searchType'] ?? true)
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.searchType}
              onChange={(v, m) => handleFieldChange('searchType', v, m)}
              varType={BaseType.ENUM}
              allowedTypes={[BaseType.ENUM, BaseType.STRING]}
              fieldOptions={{ enum: searchTypeOptions }}
              mode={VAR_MODE.PICKER}
              placeholder='Select search type'
              placeholderConstant='Select search type'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['searchType'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Limit'
            description='Maximum number of results to return (1-25). Knowledge passages are prose — a large limit makes a large prompt if these results feed an AI or Answer node.'
            type={BaseType.NUMBER}
            onClear={
              nodeData.limit != null && nodeData.limit !== ''
                ? () => handleNumberChange('limit', '', nodeData.fieldModes?.['limit'] ?? true)
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.limit}
              onChange={(v, m) => handleNumberChange('limit', v, m)}
              varType={BaseType.NUMBER}
              allowedTypes={[BaseType.NUMBER]}
              mode={VAR_MODE.PICKER}
              placeholder='20'
              placeholderConstant='20'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['limit'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Similarity Threshold'
            description='Minimum similarity score for vector search (0.0-1.0). Leave empty to use the search default.'
            type={BaseType.NUMBER}
            onClear={
              nodeData.similarityThreshold != null && nodeData.similarityThreshold !== ''
                ? () =>
                    handleNumberChange(
                      'similarityThreshold',
                      '',
                      nodeData.fieldModes?.['similarityThreshold'] ?? true
                    )
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.similarityThreshold}
              onChange={(v, m) => handleNumberChange('similarityThreshold', v, m)}
              varType={BaseType.NUMBER}
              allowedTypes={[BaseType.NUMBER]}
              mode={VAR_MODE.PICKER}
              placeholder='0.4'
              placeholderConstant='0.4'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['similarityThreshold'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='One result per document'
            description='Return the single best passage from each article or document instead of every matching segment.'
            type={BaseType.BOOLEAN}>
            <Switch
              checked={nodeData.dedupePerDocument === true}
              onCheckedChange={(checked) => handleToggleChange('dedupePerDocument', checked)}
              disabled={isReadOnly}
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

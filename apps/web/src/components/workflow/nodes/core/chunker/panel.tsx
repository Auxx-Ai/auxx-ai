// apps/web/src/components/workflow/nodes/core/chunker/panel.tsx

'use client'

import { produce } from 'immer'
import type React from 'react'
import { memo, useCallback } from 'react'
import { useNodeCrud } from '~/components/workflow/hooks'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { getChunkerOutputVariables } from './output-variables'
import type { ChunkerNodeData } from './types'

interface ChunkerPanelProps {
  nodeId: string
  data: ChunkerNodeData
}

/**
 * Chunker node configuration panel
 * Allows configuration of chunking parameters
 */
const ChunkerPanelComponent: React.FC<ChunkerPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData, setInputs } = useNodeCrud<ChunkerNodeData>(nodeId, data)

  /**
   * Handle content change
   * Clears value when switching between constant/variable mode
   */
  const handleContentChange = useCallback(
    (value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.['content'] ?? false
        const modeChanged = wasConstantMode !== isConstantMode

        // Clear value when switching modes
        draft.content = modeChanged ? '' : value
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['content'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle number field change (chunkSize, chunkOverlap)
   * In variable mode, store the variable reference as string
   * In constant mode, parse and store as number
   * Clears value when switching between constant/variable mode
   */
  const handleNumberChange = useCallback(
    (field: 'chunkSize' | 'chunkOverlap', value: any, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        if (modeChanged) {
          // Clear value when switching modes
          draft[field] = undefined
        } else if (isConstantMode) {
          // Constant mode: parse as number
          const numValue = typeof value === 'number' ? value : parseInt(value, 10)
          draft[field] = isNaN(numValue) ? undefined : numValue
        } else {
          // Variable mode: store as string (variable reference)
          draft[field] = value as any
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle delimiter change
   * Clears value when switching between constant/variable mode
   */
  const handleDelimiterChange = useCallback(
    (value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.['delimiter'] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        // Clear value when switching modes
        draft.delimiter = modeChanged ? undefined : value || undefined
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['delimiter'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle boolean option changes
   * In variable mode, store the variable reference as string
   * In constant mode, store as boolean
   * Clears value when switching between constant/variable mode
   */
  const handleBooleanChange = useCallback(
    (field: 'normalizeWhitespace' | 'removeUrlsAndEmails', value: any, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        if (modeChanged) {
          // Clear value when switching modes (default to false for booleans)
          draft[field] = isConstantMode ? false : undefined
        } else if (isConstantMode) {
          // Constant mode: store as boolean
          draft[field] = value === true
        } else {
          // Variable mode: store as string (variable reference)
          draft[field] = value as any
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Input Section */}
      <Section title='Input'>
        <VarEditorField className='p-0'>
          <VarEditorFieldRow
            className='pe-2'
            title='Content'
            description='The text content to split into chunks'
            type={BaseType.STRING}
            isRequired>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.content || ''}
              onChange={handleContentChange}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.PICKER}
              placeholder='Select content from previous node'
              placeholderConstant='Enter text to chunk...'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['content'] ?? false}
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      {/* Settings Section */}
      <Section title='Settings'>
        <VarEditorField className='p-0'>
          <VarEditorFieldRow
            className=''
            isRequired
            title='Chunk Size'
            description='Maximum size of each chunk in characters'
            type={BaseType.NUMBER}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.chunkSize}
              onChange={(value, isConstantMode) =>
                handleNumberChange('chunkSize', value, isConstantMode)
              }
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant='Enter chunk size'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['chunkSize'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=''
            isRequired
            title='Chunk Overlap'
            description='Number of overlapping characters between chunks'
            type={BaseType.NUMBER}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.chunkOverlap}
              onChange={(value, isConstantMode) =>
                handleNumberChange('chunkOverlap', value, isConstantMode)
              }
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant='Enter overlap'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['chunkOverlap'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=''
            isRequired
            title='Delimiter'
            description='Custom delimiter for splitting (e.g., \n\n for paragraphs). Leave empty for auto-detect.'
            type={BaseType.STRING}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.delimiter}
              onChange={handleDelimiterChange}
              varType={BaseType.STRING}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.STRING]}
              placeholder='Pick variable'
              placeholderConstant='Auto-detect'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['delimiter'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=''
            title='Norm. Whitespace'
            description='Replace consecutive spaces and newlines with single space'
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.normalizeWhitespace}
              onChange={(value, isConstantMode) =>
                handleBooleanChange('normalizeWhitespace', value, isConstantMode)
              }
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['normalizeWhitespace'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=''
            title='Remove URLs & Emails'
            description='Strip URLs and email addresses from content before chunking'
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.removeUrlsAndEmails}
              onChange={(value, isConstantMode) =>
                handleBooleanChange('removeUrlsAndEmails', value, isConstantMode)
              }
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['removeUrlsAndEmails'] ?? true}
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getChunkerOutputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const ChunkerPanel = memo(ChunkerPanelComponent)

// apps/web/src/components/workflow/nodes/core/dataset/panel.tsx

'use client'

import { DocumentTypeValues } from '@auxx/database/enums'
import { DATASET_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { produce } from 'immer'
import type React from 'react'
import { memo, useCallback } from 'react'
import { useNodeCrud } from '~/components/workflow/hooks'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
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
import { getDatasetOutputVariables } from './output-variables'
import type { DatasetNodeData } from './types'

interface DatasetPanelProps {
  nodeId: string
  data: DatasetNodeData
}

/** Fields that can be updated via generic handler */
type StringField =
  | 'datasetId'
  | 'chunks'
  | 'documentTitle'
  | 'mimeType'
  | 'documentType'
  | 'sourceUrl'

/** Boolean toggles, which the engine defaults differently from one another */
type BooleanField = 'skipEmbedding' | 'waitForEmbeddings'

const { DEFAULT_WAIT_FOR_EMBEDDINGS, DEFAULT_TIMEOUT_MINUTES, MIN_TIMEOUT_MINUTES } =
  DATASET_NODE_CONSTANTS.EMBEDDING_WAIT

/**
 * What an unset toggle means to the engine, so switching a field back to
 * constant mode restores what it does when nobody touched it.
 */
const BOOLEAN_FIELD_DEFAULTS: Record<BooleanField, boolean> = {
  skipEmbedding: false,
  waitForEmbeddings: DEFAULT_WAIT_FOR_EMBEDDINGS,
}

/**
 * Dataset node configuration panel
 * Allows configuration of dataset selection, chunks input, and document settings
 */
const DatasetPanelComponent: React.FC<DatasetPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData, setInputs } = useNodeCrud<DatasetNodeData>(nodeId, data)

  /**
   * Generic handler for string field changes
   */
  const handleFieldChange = useCallback(
    (field: StringField, value: VarEditorValue, isConstantMode: boolean) => {
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
   * Handle file reference change (may receive array from FileInput)
   */
  const handleFileIdChange = useCallback(
    (value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.fileId = Array.isArray(value)
          ? varEditorText(value[0]) || undefined
          : varEditorText(value) || undefined
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['fileId'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle boolean field change
   *
   * Constant mode stores a real boolean; variable mode stores the variable
   * reference so the engine can resolve it at run time. Collapsing both to
   * `value === true` would pin every bound toggle to `false`.
   */
  const handleBooleanChange = useCallback(
    (field: BooleanField, value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true

        if (wasConstantMode !== isConstantMode) {
          // Clear the value when switching modes — a reference is meaningless
          // as a literal, and vice versa. Clearing back to constant mode lands
          // on the field's own default, not a blanket `false`.
          draft[field] = isConstantMode ? BOOLEAN_FIELD_DEFAULTS[field] : undefined
        } else if (isConstantMode) {
          draft[field] = value === true
        } else {
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
   * Handle the embedding timeout, which is a number in constant mode and a
   * variable reference in variable mode.
   */
  const handleTimeoutChange = useCallback(
    (value: VarEditorValue, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.['embeddingTimeoutMinutes'] ?? true

        if (wasConstantMode !== isConstantMode) {
          draft.embeddingTimeoutMinutes = undefined
        } else if (isConstantMode) {
          const parsed =
            typeof value === 'number' ? value : Number.parseInt(varEditorText(value), 10)
          draft.embeddingTimeoutMinutes = Number.isNaN(parsed) ? undefined : parsed
        } else {
          draft.embeddingTimeoutMinutes = varEditorText(value) || undefined
        }

        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['embeddingTimeoutMinutes'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  // Document type enum options
  const documentTypeOptions = DocumentTypeValues.map((type) => ({
    label: type,
    value: type,
  }))

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Target Section - Dataset and Chunks */}
      <Section title='Target'>
        <Field title='Dataset' description='Select the dataset to add chunks to'>
          <VarEditorField className='p-0'>
            <VarEditorFieldRow
              title='Dataset'
              description='Target dataset for storing chunks'
              type={BaseType.RELATION}
              isRequired
              onClear={
                nodeData.datasetId
                  ? () =>
                      handleFieldChange('datasetId', '', nodeData.fieldModes?.['datasetId'] ?? true)
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.datasetId || ''}
                onChange={(v, m) => handleFieldChange('datasetId', v, m)}
                varType={BaseType.RELATION}
                fieldOptions={{ fieldReference: 'dataset' }}
                allowedTypes={['dataset' as BaseType, BaseType.STRING]}
                mode={VAR_MODE.PICKER}
                placeholder='Select dataset'
                allowConstant
                isConstantMode={nodeData.fieldModes?.['datasetId'] ?? true}
                hideClearButton
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </Field>

        <Field title='Chunks' description='Chunked content from Chunker node'>
          <VarEditorField className='p-0'>
            <VarEditorFieldRow
              title='Chunks'
              description='Array of document chunks to store'
              type={BaseType.ARRAY}
              isRequired
              onClear={nodeData.chunks ? () => handleFieldChange('chunks', '', false) : undefined}>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.chunks || ''}
                onChange={(v, m) => handleFieldChange('chunks', v, m)}
                varType={BaseType.ARRAY}
                allowedTypes={[BaseType.ARRAY]}
                mode={VAR_MODE.PICKER}
                placeholder='Select chunks from Chunker node'
                allowConstant={false}
                isConstantMode={false}
                hideClearButton
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </Field>
      </Section>

      {/* Document Settings Section */}
      <Section title='Document Settings' initialOpen={true}>
        <VarEditorField className='p-0'>
          <VarEditorFieldRow
            title='Document Title'
            description='Title for the document entry'
            type={BaseType.STRING}
            isRequired
            onClear={
              nodeData.documentTitle
                ? () =>
                    handleFieldChange(
                      'documentTitle',
                      '',
                      nodeData.fieldModes?.['documentTitle'] ?? true
                    )
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.documentTitle || ''}
              onChange={(v, m) => handleFieldChange('documentTitle', v, m)}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder='Enter document title'
              placeholderConstant='Workflow Document'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['documentTitle'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Document Type'
            description='Type of document (PDF, TXT, etc.)'
            type={BaseType.ENUM}
            onClear={
              nodeData.documentType
                ? () =>
                    handleFieldChange(
                      'documentType',
                      '',
                      nodeData.fieldModes?.['documentType'] ?? true
                    )
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.documentType || ''}
              onChange={(v, m) => handleFieldChange('documentType', v, m)}
              varType={BaseType.ENUM}
              allowedTypes={[BaseType.ENUM, BaseType.STRING]}
              fieldOptions={{ enum: documentTypeOptions }}
              mode={VAR_MODE.PICKER}
              placeholder='Select document type'
              placeholderConstant='TXT'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['documentType'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Mime Type'
            description="Content mime type (e.g., 'text/plain', 'application/pdf')"
            type={BaseType.STRING}
            onClear={
              nodeData.mimeType
                ? () => handleFieldChange('mimeType', '', nodeData.fieldModes?.['mimeType'] ?? true)
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.mimeType || 'text/plain'}
              onChange={(v, m) => handleFieldChange('mimeType', v, m)}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder='text/plain'
              placeholderConstant='text/plain'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['mimeType'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Source URL'
            description='Original source URL for reference'
            type={BaseType.URL}
            onClear={
              nodeData.sourceUrl
                ? () =>
                    handleFieldChange('sourceUrl', '', nodeData.fieldModes?.['sourceUrl'] ?? true)
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.sourceUrl || ''}
              onChange={(v, m) => handleFieldChange('sourceUrl', v, m)}
              varType={BaseType.URL}
              allowedTypes={[BaseType.URL, BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder='https://example.com/source'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['sourceUrl'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='File Reference'
            description='Link to source file (MediaAsset) if available'
            type={BaseType.FILE}
            onClear={
              nodeData.fileId
                ? () => handleFileIdChange('', nodeData.fieldModes?.['fileId'] ?? false)
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.fileId || ''}
              onChange={handleFileIdChange}
              varType={BaseType.FILE}
              allowedTypes={[BaseType.FILE]}
              mode={VAR_MODE.PICKER}
              placeholder='Select source file'
              allowConstant
              isConstantMode={nodeData.fieldModes?.['fileId'] ?? false}
              fieldOptions={{ allowMultiple: false }}
              hideClearButton
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      {/* Processing Options Section */}
      <Section title='Processing Options' initialOpen={false}>
        <VarEditorField className='p-0'>
          <VarEditorFieldRow
            className='pe-2'
            title='Skip Embedding'
            description='Skip embedding generation (chunks will not be searchable)'
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.skipEmbedding}
              onChange={(v, m) => handleBooleanChange('skipEmbedding', v, m)}
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['skipEmbedding'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className='pe-2'
            title='Wait for Embeddings'
            description='On: the workflow pauses here until this document is embedded, so a later node reading this dataset finds it. Off: the workflow continues immediately and the embeddings finish in the background. Ignored when Skip Embedding is on.'
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.waitForEmbeddings ?? DEFAULT_WAIT_FOR_EMBEDDINGS}
              onChange={(v, m) => handleBooleanChange('waitForEmbeddings', v, m)}
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['waitForEmbeddings'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Embedding Timeout (minutes)'
            description={`How long that wait may last. If the embeddings are not done by then the workflow continues anyway with Embedding Status = "timeout" — it never waits forever. Clamped to ${MIN_TIMEOUT_MINUTES}–${DATASET_NODE_CONSTANTS.EMBEDDING_WAIT.MAX_TIMEOUT_MINUTES} minutes.`}
            type={BaseType.NUMBER}
            onClear={
              nodeData.embeddingTimeoutMinutes != null && nodeData.embeddingTimeoutMinutes !== ''
                ? () =>
                    handleTimeoutChange(
                      '',
                      nodeData.fieldModes?.['embeddingTimeoutMinutes'] ?? true
                    )
                : undefined
            }>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.embeddingTimeoutMinutes}
              onChange={handleTimeoutChange}
              varType={BaseType.NUMBER}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.NUMBER]}
              placeholder='Pick variable'
              placeholderConstant={String(DEFAULT_TIMEOUT_MINUTES)}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['embeddingTimeoutMinutes'] ?? true}
              hideClearButton
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getDatasetOutputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const DatasetPanel = memo(DatasetPanelComponent)

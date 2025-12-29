// apps/web/src/components/workflow/nodes/core/dataset/panel.tsx

'use client'

import React, { memo, useCallback } from 'react'
import { produce } from 'immer'
import { type DatasetNodeData } from './types'
import { BasePanel } from '../../shared/base/base-panel'
import { useNodeCrud } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'
import Field from '~/components/workflow/ui/field'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { VAR_MODE, BaseType } from '~/components/workflow/types'
import { getDatasetOutputVariables } from './output-variables'
import { DocumentTypeValues } from '@auxx/database/enums'

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
    (field: StringField, value: string, isConstantMode: boolean) => {
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
   * Handle file reference change (may receive array from FileInput)
   */
  const handleFileIdChange = useCallback(
    (value: string | string[], isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.fileId = Array.isArray(value) ? value[0] || undefined : value || undefined
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['fileId'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle boolean field change
   */
  const handleBooleanChange = useCallback(
    (field: 'skipEmbedding', value: unknown, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft[field] = value === true
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
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
      <Section title="Target">
        <Field title="Dataset" description="Select the dataset to add chunks to">
          <VarEditorField className="p-0">
            <VarEditorFieldRow
              title="Dataset"
              description="Target dataset for storing chunks"
              type={BaseType.RELATION}
              isRequired>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.datasetId || ''}
                onChange={(v, m) => handleFieldChange('datasetId', v, m)}
                varType={BaseType.RELATION}
                fieldReference="dataset"
                allowedTypes={['dataset' as BaseType, BaseType.STRING]}
                mode={VAR_MODE.PICKER}
                placeholder="Select dataset"
                allowConstant
                isConstantMode={nodeData.fieldModes?.['datasetId'] ?? true}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </Field>

        <Field title="Chunks" description="Chunked content from Chunker node">
          <VarEditorField className="p-0">
            <VarEditorFieldRow
              title="Chunks"
              description="Array of document chunks to store"
              type={BaseType.ARRAY}
              isRequired>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.chunks || ''}
                onChange={(v, m) => handleFieldChange('chunks', v, m)}
                varType={BaseType.ARRAY}
                allowedTypes={[BaseType.ARRAY]}
                mode={VAR_MODE.PICKER}
                placeholder="Select chunks from Chunker node"
                allowConstant={false}
                isConstantMode={false}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </Field>
      </Section>

      {/* Document Settings Section */}
      <Section title="Document Settings" initialOpen={true}>
        <VarEditorField className="p-0">
          <VarEditorFieldRow
            title="Document Title"
            description="Title for the document entry"
            type={BaseType.STRING}
            isRequired>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.documentTitle || ''}
              onChange={(v, m) => handleFieldChange('documentTitle', v, m)}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder="Enter document title"
              placeholderConstant="Workflow Document"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['documentTitle'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Document Type"
            description="Type of document (PDF, TXT, etc.)"
            type={BaseType.ENUM}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.documentType || ''}
              onChange={(v, m) => handleFieldChange('documentType', v, m)}
              varType={BaseType.ENUM}
              allowedTypes={[BaseType.ENUM, BaseType.STRING]}
              fieldOptions={{ enum: documentTypeOptions }}
              mode={VAR_MODE.PICKER}
              placeholder="Select document type"
              placeholderConstant="TXT"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['documentType'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Mime Type"
            description="Content mime type (e.g., 'text/plain', 'application/pdf')"
            type={BaseType.STRING}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.mimeType || 'text/plain'}
              onChange={(v, m) => handleFieldChange('mimeType', v, m)}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder="text/plain"
              placeholderConstant="text/plain"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['mimeType'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Source URL"
            description="Original source URL for reference"
            type={BaseType.URL}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.sourceUrl || ''}
              onChange={(v, m) => handleFieldChange('sourceUrl', v, m)}
              varType={BaseType.URL}
              allowedTypes={[BaseType.URL, BaseType.STRING]}
              mode={VAR_MODE.RICH}
              placeholder="https://example.com/source"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['sourceUrl'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="File Reference"
            description="Link to source file (MediaAsset) if available"
            type={BaseType.FILE}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.fileId || ''}
              onChange={handleFileIdChange}
              varType={BaseType.FILE}
              allowedTypes={[BaseType.FILE]}
              mode={VAR_MODE.PICKER}
              placeholder="Select source file"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['fileId'] ?? false}
              fieldOptions={{ allowMultiple: false }}
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      {/* Processing Options Section */}
      <Section title="Processing Options" initialOpen={false}>
        <VarEditorField className="p-0">
          <VarEditorFieldRow
            className="pe-2"
            title="Skip Embedding"
            description="Skip embedding generation (chunks will not be searchable)"
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

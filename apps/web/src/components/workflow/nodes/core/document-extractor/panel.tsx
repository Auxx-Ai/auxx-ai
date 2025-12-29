// apps/web/src/components/workflow/nodes/core/document-extractor/panel.tsx

'use client'

import React, { memo, useCallback } from 'react'
import { produce } from 'immer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { type DocumentExtractorNodeData, DocumentSourceType } from './types'
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
import { getDocumentExtractorOutputVariables } from './output-variables'
import { FileText, Link } from 'lucide-react'

interface DocumentExtractorPanelProps {
  nodeId: string
  data: DocumentExtractorNodeData
}

/**
 * Document Extractor node configuration panel
 * Allows configuration of source type (file/url) and extraction options
 */
const DocumentExtractorPanelComponent: React.FC<DocumentExtractorPanelProps> = ({
  nodeId,
  data,
}) => {
  const { inputs: nodeData, setInputs } = useNodeCrud<DocumentExtractorNodeData>(nodeId, data)

  /**
   * Handle source type change (file/url)
   * Clears the opposite field when switching
   */
  const handleSourceTypeChange = useCallback(
    (sourceType: DocumentSourceType) => {
      const newData = produce(nodeData, (draft) => {
        draft.sourceType = sourceType
        // Clear the field that's no longer applicable
        if (sourceType === DocumentSourceType.FILE) {
          draft.url = undefined
        } else {
          draft.fileId = undefined
        }
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle file selection change
   * FileInput returns array even with allowMultiple: false, so extract first element
   */
  const handleFileChange = useCallback(
    (value: string | string[], isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        // FileInput returns array, extract first element for single file mode
        if (Array.isArray(value)) {
          draft.fileId = value[0] || undefined
        } else {
          draft.fileId = value || undefined
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['fileId'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle URL change
   */
  const handleUrlChange = useCallback(
    (value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.url = value
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['url'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle extraction option changes (boolean fields)
   * Value comes as boolean from BooleanInput via ConstantInputAdapter
   */
  const handleOptionChange = useCallback(
    (field: 'preserveFormatting' | 'extractImages', value: any, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        // Value is already a boolean from BooleanInput
        draft[field] = value === true
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /**
   * Handle language hint change
   */
  const handleLanguageChange = useCallback(
    (value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.language = value || undefined
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes['language'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      <Section title="Source">
        <Field
          title="Document Source"
          description="Select the source of the document to extract content from">
          <VarEditorField className="">
            {/* Source Type Selector Row */}
            <div className="flex flex-row gap-1 h-7">
              <div className="pt-0.5">
                <Select
                  value={nodeData.sourceType}
                  onValueChange={(value) => handleSourceTypeChange(value as DocumentSourceType)}>
                  <SelectTrigger variant="outline" size="xs" className="w-25">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DocumentSourceType.FILE}>
                      <div className="flex items-center gap-2">
                        <FileText className="size-4" />
                        File
                      </div>
                    </SelectItem>
                    <SelectItem value={DocumentSourceType.URL}>
                      <div className="flex items-center gap-2">
                        <Link className="size-4" />
                        URL
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {nodeData.sourceType === DocumentSourceType.FILE ? (
                <VarEditor
                  nodeId={nodeId}
                  value={nodeData.fileId || ''}
                  onChange={handleFileChange}
                  varType={BaseType.FILE}
                  allowedTypes={[BaseType.FILE]}
                  mode={VAR_MODE.PICKER}
                  placeholder="Select file"
                  allowConstant
                  isConstantMode={nodeData.fieldModes?.['fileId'] ?? true}
                  fieldOptions={{ allowMultiple: false }}
                />
              ) : (
                <VarEditor
                  nodeId={nodeId}
                  value={nodeData.url || ''}
                  onChange={handleUrlChange}
                  varType={BaseType.URL}
                  allowedTypes={[BaseType.URL, BaseType.STRING]}
                  mode={VAR_MODE.RICH}
                  placeholder="https://example.com/document.pdf"
                  placeholderConstant="https://example.com/document.pdf"
                  allowConstant
                  isConstantMode={nodeData.fieldModes?.['url'] ?? true}
                />
              )}
            </div>

            {/* Dynamic Input Based on Source Type */}
          </VarEditorField>
        </Field>
      </Section>

      <Section title="Extraction Options" initialOpen={false}>
        <VarEditorField className="p-0">
          <VarEditorFieldRow
            title="Preserve Formatting"
            description="Attempt to preserve document formatting in extracted text"
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.preserveFormatting ?? false}
              onChange={(value, isConstantMode) =>
                handleOptionChange('preserveFormatting', value, isConstantMode)
              }
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['preserveFormatting'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Extract Images"
            description="Extract image descriptions using OCR/AI (slower)"
            type={BaseType.BOOLEAN}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.extractImages ?? false}
              onChange={(value, isConstantMode) =>
                handleOptionChange('extractImages', value, isConstantMode)
              }
              fieldOptions={{ variant: 'switch' }}
              varType={BaseType.BOOLEAN}
              mode={VAR_MODE.PICKER}
              allowedTypes={[BaseType.BOOLEAN]}
              allowConstant
              isConstantMode={nodeData.fieldModes?.['extractImages'] ?? true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="Language Hint"
            description="Language code for OCR (e.g., 'en', 'es', 'fr'). Leave empty for auto-detect."
            type={BaseType.STRING}>
            <VarEditor
              nodeId={nodeId}
              value={nodeData.language || ''}
              onChange={handleLanguageChange}
              varType={BaseType.STRING}
              allowedTypes={[BaseType.STRING]}
              mode={VAR_MODE.PICKER}
              placeholder="Auto-detect"
              placeholderConstant="Auto-detect"
              allowConstant
              isConstantMode={nodeData.fieldModes?.['language'] ?? true}
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getDocumentExtractorOutputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const DocumentExtractorPanel = memo(DocumentExtractorPanelComponent)

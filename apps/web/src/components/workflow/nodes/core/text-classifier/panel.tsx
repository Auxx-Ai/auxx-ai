// apps/web/src/components/workflow/nodes/core/text-classifier/panel.tsx

'use client'

import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import type React from 'react'
import { memo } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import ModelParameterModal from '~/components/workflow/ui/model-parameter'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import Section from '~/components/workflow/ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { CategoriesList } from './components/categories-list'
import { textClassifierDefinition } from './schema'
import { TextClassifierProvider, useTextClassifierContext } from './text-classifier-context'
import type { TextClassifierNodeData } from './types'

/**
 * Props for TextClassifierPanel
 */
interface TextClassifierPanelProps {
  nodeId: string
  data: TextClassifierNodeData
}

/**
 * Internal panel component that uses the context
 */
const TextClassifierPanelContent: React.FC<TextClassifierPanelProps> = ({ data, nodeId }) => {
  const { isReadOnly, updateModel, updateText, updateVision, updateInstruction } =
    useTextClassifierContext()

  // Handle text change from editor - no callback needed
  const handleTextChange = (value: string) => {
    updateText(value)
  }

  // Handle instruction change from editor - no callback needed
  const handleInstructionChange = (value: string) => {
    updateInstruction(true, value)
  }

  return (
    <>
      {/* Model & Parameters Section */}
      <Section
        title='Model & Parameters'
        description='Configure the AI model and its parameters.'
        isRequired>
        <ModelParameterModal
          isAdvancedMode={true}
          defaultModelType='llm'
          mode={data.model.mode}
          modelId={data.model.name}
          provider={data.model.provider}
          readonly={isReadOnly}
          setModel={(model) =>
            updateModel({
              provider: model.provider,
              name: model.modelId,
              mode: (model.mode as any) || 'chat',
            })
          }
          completionParams={data.model.completion_params}
          onCompletionParamsChange={(params) =>
            updateModel({
              ...data.model,
              completion_params: { ...data.model.completion_params, ...params },
            })
          }
          hideDebugWithMultipleModel={true}
          isInWorkflow={true}
        />
      </Section>

      {/* Text to Classify Section */}
      <Section
        title='Text to Classify'
        description='Enter the text you want to classify.'
        isRequired>
        <Editor
          title={<Label className='text-sm font-medium'>Input</Label>}
          value={data.text || ''}
          onChange={handleTextChange}
          nodeId={nodeId}
          placeholder='Enter text to classify...'
          readOnly={isReadOnly}
          minHeight={100}
        />
      </Section>

      {/* Categories Section */}
      <CategoriesList />

      {/* Advanced Settings Section */}
      <Section
        title='Advanced Settings'
        description='Additional configuration options.'
        initialOpen={false}>
        <div className='space-y-4'>
          {/* Vision toggle */}
          <div className='flex items-center justify-between'>
            <div className='space-y-0.5'>
              <Label htmlFor='vision-toggle'>Enable Vision</Label>
              <p className='text-xs text-muted-foreground'>
                Allow the model to process images if supported
              </p>
            </div>
            <Switch
              size='sm'
              id='vision-toggle'
              checked={data.vision.enabled}
              onCheckedChange={updateVision}
              disabled={isReadOnly}
            />
          </div>

          {/* Custom Instructions */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='instruction-toggle'>Custom Instructions</Label>
              <Switch
                id='instruction-toggle'
                size='sm'
                checked={data.instruction.enabled}
                onCheckedChange={(enabled) => updateInstruction(enabled)}
                disabled={isReadOnly}
              />
            </div>
            {data.instruction.enabled && (
              <Editor
                title={<Label className='text-sm font-medium'>Input</Label>}
                value={data.instruction.editorContent || ''}
                onChange={handleInstructionChange}
                placeholder='Add custom instructions for classification...'
                nodeId={nodeId}
                readOnly={isReadOnly}
                minHeight={80}
              />
            )}
          </div>
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={textClassifierDefinition.outputVariables?.(data, nodeId) || []}
        initialOpen={false}
      />
    </>
  )
}

/**
 * Main text classifier panel component
 */
const TextClassifierPanelComponent: React.FC<TextClassifierPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  // Work with data directly (flattened structure)
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<TextClassifierNodeData>(
    nodeId,
    data
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <TextClassifierProvider
        nodeId={nodeId}
        data={data}
        setData={setNodeData}
        readOnly={isReadOnly}>
        <TextClassifierPanelContent data={data} nodeId={nodeId} />
      </TextClassifierProvider>
    </BasePanel>
  )
}

export const TextClassifierPanel = memo(TextClassifierPanelComponent)

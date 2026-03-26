// apps/web/src/components/workflow/nodes/core/information-extractor/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { BookText, FileJson, Pencil } from 'lucide-react'
import React, { useState } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import ModelParameterModal from '~/components/workflow/ui/model-parameter'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import StructuredOutputGenerator from '~/components/workflow/ui/structured-output-generator'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { getTemplatesArray } from './constants'
import {
  InformationExtractorProvider,
  useInformationExtractor,
} from './information-extractor-context'
import { informationExtractorDefinition } from './schema'
import type { InformationExtractorNodeData } from './types'

/**
 * Props for InformationExtractorPanel
 */
interface InformationExtractorPanelProps {
  nodeId: string
  data: InformationExtractorNodeData
}

/**
 * Internal panel component that uses the context
 */
interface InformationExtractorPanelContentProps {
  nodeId: string
  data: InformationExtractorNodeData
}

const InformationExtractorPanelContentComponent: React.FC<
  InformationExtractorPanelContentProps
> = ({ nodeId, data }) => {
  const {
    config,
    availableVariables,
    isReadOnly,
    updateModel,
    updateText,
    updateStructuredOutput,
    updateVision,
    updateInstruction,
    // preprocessPrompt,
    getOutputVariables,
  } = useInformationExtractor()

  const [isSchemaOpen, setIsSchemaOpen] = useState(false)
  // Handle instruction change from editor
  const handleInstructionChange = (text: string) => {
    updateInstruction(true, text)
  }

  // Handle text change from editor
  const handleTextChange = (text: string) => {
    updateText(text)
  }

  // Handle template selection
  const handleTemplateSelect = (template: { schema: SchemaRoot }) => {
    updateStructuredOutput(true, template.schema)
    setIsSchemaOpen(true)
  }

  const outputVariables = getOutputVariables()

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
          mode={config.model.mode}
          modelId={config.model.name}
          provider={config.model.provider}
          useDefault={config.model.useDefault ?? false}
          onUseDefaultChange={(useDefault) => {
            if (useDefault) {
              updateModel({ ...config.model, useDefault: true, provider: '', name: '' })
            } else {
              updateModel({ ...config.model, useDefault: false })
            }
          }}
          readonly={isReadOnly}
          setModel={(model) => {
            updateModel({
              useDefault: false,
              provider: model.provider,
              name: model.modelId || model.name,
              mode: model.mode || 'chat',
              completion_params: config.model.completion_params,
            })
          }}
          completionParams={config.model.completion_params || { temperature: 0.7 }}
          onCompletionParamsChange={(params) =>
            updateModel({
              ...config.model,
              completion_params: { temperature: 0.7, ...config.model.completion_params, ...params },
            })
          }
          hideDebugWithMultipleModel={true}
          isInWorkflow={true}
        />
      </Section>

      {/* Text to Extract From Section */}
      <Section
        title='Text to Extract From'
        description='Enter the text you want to extract information from.'
        isRequired>
        <Editor
          title={<label className='text-xs font-medium'>Text Input</label>}
          value={config.text || ''}
          onChange={handleTextChange}
          nodeId={nodeId}
          placeholder='Enter text or use {{variables}}...'
          readOnly={isReadOnly}
          minHeight={100}
        />
      </Section>

      {/* Structured Output Section */}
      <Section
        title='Extraction Schema'
        description='Define what information to extract from the text.'
        isRequired>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Label className='text-xs mb-0'>Schema Configuration</Label>
              {config.structured_output?.schema && (
                <span className='text-xs text-muted-foreground'>
                  ({Object.keys(config.structured_output.schema.properties || {}).length} fields)
                </span>
              )}
            </div>
            <div className='flex items-center gap-1'>
              {/* Templates Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='xs' disabled={isReadOnly}>
                    <BookText />
                    Templates
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-64'>
                  {getTemplatesArray().map((template) => (
                    <DropdownMenuItem
                      key={template.key}
                      onClick={() => handleTemplateSelect(template)}
                      className='flex flex-col items-start gap-1 py-2'>
                      <div className='flex items-center gap-2'>
                        <FileJson className='h-4 w-4 text-muted-foreground' />
                        <span className='font-medium'>{template.name}</span>
                      </div>
                      <span className='text-xs text-muted-foreground'>{template.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Edit Schema Button */}
              <Button
                variant='outline'
                size='xs'
                onClick={() => setIsSchemaOpen(true)}
                disabled={isReadOnly}>
                <Pencil />
              </Button>
            </div>
          </div>

          {/* Structured Output Generator Modal */}
          <StructuredOutputGenerator
            isShow={isSchemaOpen}
            defaultSchema={config.structured_output?.schema}
            onSave={(newSchema) => {
              updateStructuredOutput(true, newSchema)
              setIsSchemaOpen(false)
            }}
            onClose={() => setIsSchemaOpen(false)}
          />
        </div>
      </Section>

      {/* Advanced Settings Section */}
      <Section
        title='Advanced Settings'
        description='Additional configuration options.'
        initialOpen={false}>
        <div className='space-y-4'>
          {/* Vision Toggle */}
          <div className='flex items-center justify-between'>
            <div className='space-y-0.5'>
              <Label className='text-xs'>Enable Vision</Label>
              <p className='text-xs text-muted-foreground'>
                Allow the AI to process images for extraction
              </p>
            </div>
            <Switch
              checked={config.vision.enabled}
              size='sm'
              onCheckedChange={updateVision}
              disabled={isReadOnly}
            />
          </div>

          {/* Custom Instructions */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label className='text-xs'>Custom Instructions</Label>
                <p className='text-xs text-muted-foreground'>
                  Add specific instructions for the extraction
                </p>
              </div>
              <Switch
                checked={config.instruction.enabled}
                size='sm'
                onCheckedChange={(enabled) => updateInstruction(enabled, config.instruction.text)}
                disabled={isReadOnly}
              />
            </div>

            {config.instruction.enabled && (
              <Editor
                value={config.instruction.text || ''}
                onChange={handleInstructionChange}
                nodeId={nodeId}
                placeholder='e.g., Extract only business emails, ignore personal ones...'
                minHeight={80}
                readOnly={isReadOnly}
              />
            )}
          </div>
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={informationExtractorDefinition.outputVariables(config, nodeId)}
        initialOpen={false}
      />
    </>
  )
}

const InformationExtractorPanelContent = React.memo(InformationExtractorPanelContentComponent)

/**
 * Main information extractor panel component
 */
const InformationExtractorPanelComponent: React.FC<InformationExtractorPanelProps> = ({
  nodeId,
  data,
}) => {
  const { isReadOnly } = useReadOnly()

  // if (!data) return null

  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<InformationExtractorNodeData>(
    nodeId,
    data
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <InformationExtractorProvider
        nodeId={nodeId}
        data={nodeData}
        onChange={setNodeData}
        readOnly={isReadOnly}>
        <InformationExtractorPanelContent nodeId={nodeId} data={data} />
      </InformationExtractorProvider>
    </BasePanel>
  )
}

export const InformationExtractorPanel = React.memo(InformationExtractorPanelComponent)

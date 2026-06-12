// apps/web/src/components/workflow/nodes/core/ai/panel.tsx
'use client'

import type { TiptapDoc } from '@auxx/lib/tiptap'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { produce } from 'immer'
import { Pencil, Plus } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useState } from 'react'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { SchemaEditorDialog } from '~/components/schema-editor/ui/schema-editor-dialog'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BaseType } from '~/components/workflow/types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import ModelParameterModal from '../../../ui/model-parameter'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { PROMPT_ROLES } from './constants'
import { aiDefinition } from './schema'
import { ToolsSection } from './tools/tools-section'
import type { AiNodeData, PromptTemplate } from './types'
import { AiModelMode, PromptRole } from './types'

const EMPTY_PROMPT_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Tab set for the AI-node prompt editor. Admin-authored surface, so we
 * include `tools`, `resources`, `fields` on top of the default tabs so
 * authors can pin toolsets, schema objects, and field values inline.
 */
const AI_NODE_REFERENCE_TABS: ReferenceTab[] = [...DEFAULT_TABS, 'tools', 'resources', 'fields']

interface AiPanelProps {
  nodeId: string
  data: AiNodeData
}

const AiPanelComponent: React.FC<AiPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const [isOpen, setIsOpen] = useState(false)
  const [schema, setSchema] = useState<Record<string, unknown> | undefined>()

  // Use CRUD operations for the node data
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<AiNodeData>(nodeId, data)

  // Initialize schema from data if not already set
  // biome-ignore lint/correctness/useExhaustiveDependencies: schema is intentionally excluded to only set once when not already set
  useEffect(() => {
    if (nodeData.structured_output?.schema && !schema) {
      setSchema(nodeData.structured_output.schema as Record<string, unknown>)
    }
  }, [nodeData.structured_output?.schema])

  // Direct update handlers
  const updateModel = (updates: Partial<AiNodeData['model']>) => {
    setNodeData({ ...nodeData, model: { ...nodeData.model, ...updates } })
  }

  const updateCompletionParams = (updates: Partial<AiNodeData['model']['completion_params']>) => {
    const newData = produce(nodeData, (draft: AiNodeData) => {
      if (!draft.model) {
        draft.model = {
          provider: '',
          name: '',
          mode: AiModelMode.CHAT,
          completion_params: { temperature: 0.7 },
        }
      }
      Object.assign(draft.model.completion_params, updates)
    })
    setNodeData(newData)
  }

  const updatePromptTemplate = (index: number, updates: Partial<PromptTemplate>) => {
    const newData = produce(nodeData, (draft: AiNodeData) => {
      if (!draft.prompt_template) {
        draft.prompt_template = [{ role: PromptRole.SYSTEM, json: EMPTY_PROMPT_DOC }]
      }
      Object.assign(draft.prompt_template[index], updates)
    })
    setNodeData(newData)
  }

  const addPromptTemplate = () => {
    const newData = produce(nodeData, (draft: AiNodeData) => {
      if (!draft.prompt_template) {
        draft.prompt_template = []
      }
      draft.prompt_template.push({ role: PromptRole.USER, json: EMPTY_PROMPT_DOC })
    })
    setNodeData(newData)
  }

  const removePromptTemplate = (index: number) => {
    const templates = nodeData.prompt_template || []
    if (templates.length > 1) {
      const newData = produce(nodeData, (draft: AiNodeData) => {
        draft.prompt_template.splice(index, 1)
      })
      setNodeData(newData)
    }
  }

  // Files update handlers
  const updateFilesEnabled = useCallback(
    (enabled: boolean) => {
      const newData = produce(nodeData, (draft: AiNodeData) => {
        if (!draft.files) draft.files = { enabled: false, input: '', isConstant: false }
        draft.files.enabled = enabled
      })
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  const updateFileInput = useCallback(
    (value: string | boolean | string[], isConstantMode?: boolean) => {
      const newData = produce(nodeData, (draft: AiNodeData) => {
        if (!draft.files) draft.files = { enabled: false, input: '', isConstant: false }
        // FileInput returns string[] of prefixed file IDs; variable picker returns a string
        draft.files.input = Array.isArray(value) ? value.join(',') : String(value)
        draft.files.isConstant = isConstantMode ?? false
      })
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  return (
    <BasePanel title='AI Configuration' nodeId={nodeId} data={data} showNextStep={true}>
      {/* Model Configuration */}

      <Section
        title='Model & Parameters'
        description='Configure the AI model and its parameters.'
        isRequired
        initialOpen>
        <ModelParameterModal
          isAdvancedMode
          defaultModelType='llm'
          mode={nodeData.model?.mode || AiModelMode.CHAT}
          modelId={nodeData.model?.name || ''}
          provider={nodeData.model?.provider || ''}
          useDefault={nodeData.model?.useDefault ?? false}
          onUseDefaultChange={(useDefault) => {
            if (useDefault) {
              updateModel({ useDefault: true, provider: '', name: '' })
            } else {
              updateModel({ useDefault: false })
            }
          }}
          readonly={isReadOnly}
          setModel={(model) =>
            updateModel({
              useDefault: false,
              provider: model.provider,
              name: model.modelId,
              mode: (model.mode as any) || 'chat',
            })
          }
          completionParams={nodeData.model?.completion_params || { temperature: 0.7 }}
          onCompletionParamsChange={(params) => updateCompletionParams(params)}
          hideDebugWithMultipleModel
          isInWorkflow
        />
      </Section>
      <Section
        title='Prompt Templates'
        description='Configure the AI prompt templates.'
        isRequired
        initialOpen
        actions={
          !isReadOnly && (
            <Button
              variant='ghost'
              size='sm'
              onClick={addPromptTemplate}
              disabled={(nodeData.prompt_template?.length || 0) >= 5}>
              <Plus />
              Add Prompt Template
            </Button>
          )
        }>
        <div className='space-y-2'>
          {(nodeData.prompt_template || [{ role: PromptRole.SYSTEM, json: EMPTY_PROMPT_DOC }]).map(
            (template: PromptTemplate, index: number) => (
              <Editor
                key={index}
                title={
                  index === 0 ? (
                    <span className='text-xs font-semibold text-muted-foreground'>System</span>
                  ) : (
                    <TemplateRoleSelect
                      value={template.role}
                      onChange={(role) => updatePromptTemplate(index, { role })}
                      disabled={isReadOnly}
                    />
                  )
                }
                readOnly={isReadOnly}
                valueJson={template.json}
                onChangeJson={(json) => updatePromptTemplate(index, { json })}
                placeholder='Use { for variables, @ for references'
                nodeId={nodeId}
                includeEnvironment
                includeSystem
                showRemove={index > 0}
                onRemove={() => removePromptTemplate(index)}
                minHeight={index === 0 ? 200 : 56}
                enableReferencePicker
                referenceTabs={AI_NODE_REFERENCE_TABS}
              />
            )
          )}
        </div>
      </Section>
      <Section
        title='Advanced Settings'
        description='Configure the AI advanced settings.'
        initialOpen={false}>
        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-xs'>Enable Context</Label>
            <Switch
              checked={nodeData.context?.enabled || false}
              size='sm'
              disabled={isReadOnly}
              onCheckedChange={(enabled) => {
                const newData = produce(nodeData, (draft: AiNodeData) => {
                  if (!draft.context) {
                    draft.context = { enabled: false, variable_selector: [] }
                  }
                  draft.context.enabled = enabled
                })
                setNodeData(newData)
              }}
            />
          </div>
        </div>
      </Section>

      <Section
        title='Attach Files'
        description='Attach file variables (PDFs, text files) for the AI to analyze'
        showEnable
        onEnableChange={updateFilesEnabled}
        enabled={nodeData.files?.enabled || false}
        initialOpen={nodeData.files?.enabled || false}>
        <VarEditorField>
          <VarEditor
            value={nodeData.files?.input || ''}
            onChange={updateFileInput}
            varType={BaseType.FILE}
            allowedTypes={[BaseType.FILE, BaseType.ARRAY]}
            nodeId={nodeId}
            disabled={isReadOnly}
            allowConstant
            isConstantMode={nodeData.files?.isConstant ?? false}
            placeholder='Select file variable'
          />
        </VarEditorField>
      </Section>

      <ToolsSection data={nodeData} setData={setNodeData} />

      <Section
        title='Structured Output'
        description='Configure the AI structured output settings.'
        showEnable
        onEnableChange={(enabled) => {
          const newData = produce(nodeData, (draft: AiNodeData) => {
            if (!draft.structured_output) {
              draft.structured_output = { enabled: false }
            }
            draft.structured_output.enabled = enabled
          })
          setNodeData(newData)
        }}
        enabled={nodeData.structured_output?.enabled || false}
        initialOpen={nodeData.structured_output?.enabled || false}>
        <div className='space-y-2'>
          {nodeData.structured_output?.enabled && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label className='text-xs mb-0'>Schema Configuration</Label>
                  {schema && (
                    <span className='text-xs text-muted-foreground'>
                      ({Object.keys((schema.properties as Record<string, unknown>) || {}).length}{' '}
                      fields)
                    </span>
                  )}
                </div>
                <Button variant='outline' size='xs' onClick={() => setIsOpen(true)}>
                  <Pencil />
                </Button>
              </div>

              <SchemaEditorDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                title='Structured Output'
                initial={{
                  schema: schema ?? { type: 'object', properties: {} },
                  seededFrom: schema ? 'existing' : 'empty',
                }}
                policy={{ emitRequired: true }}
                onSave={(newSchema) => {
                  setSchema(newSchema)
                  // Update the config with schema only
                  const newData = produce(nodeData, (draft: AiNodeData) => {
                    if (!draft.structured_output) {
                      draft.structured_output = { enabled: false }
                    }
                    draft.structured_output.enabled = true
                    draft.structured_output.schema =
                      newSchema as AiNodeData['structured_output']['schema']
                  })
                  setNodeData(newData)
                }}
              />
            </div>
          )}
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={aiDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const AiPanel = memo(AiPanelComponent)

function TemplateRoleSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: PromptRole
  onChange: (role: PromptRole) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PromptRole)} disabled={disabled}>
      <SelectTrigger className='h-8 border-0 px-0 bg-transparent hover:bg-transparent focus:bg-transparent shadow-none'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROMPT_ROLES.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {role.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

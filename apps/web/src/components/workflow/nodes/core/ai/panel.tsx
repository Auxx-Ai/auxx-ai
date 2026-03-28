// apps/web/src/components/workflow/nodes/core/ai/panel.tsx

import { Badge } from '@auxx/ui/components/badge'
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
import { cn } from '@auxx/ui/lib/utils'
import { produce } from 'immer'
import { AlertTriangle, Pencil, Plus, Wrench, X } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useState } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { BaseType } from '~/components/workflow/types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import StructuredOutputGenerator, {
  type SchemaRoot,
} from '~/components/workflow/ui/structured-output-generator'
import ModelParameterModal from '../../../ui/model-parameter'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { PROMPT_ROLES } from './constants'
import { aiDefinition } from './schema'
import {
  CredentialStatusBadge,
  getToolCredentialStatus,
  hasCredentialIssue,
} from './tool-credential-status'
import { ToolsSelectionDialog } from './tools-selection-dialog'
import type { AiNodeData, PromptTemplate } from './types'
import { AiModelMode, PromptRole } from './types'

interface AiPanelProps {
  nodeId: string
  data: AiNodeData
}

const AiPanelComponent: React.FC<AiPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const [isOpen, setIsOpen] = useState(false)
  const [schema, setSchema] = useState<SchemaRoot | undefined>()
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const nodes = useWorkflowStore((state) => state.nodes)

  // Use CRUD operations for the node data
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<AiNodeData>(nodeId, data)

  // Initialize schema from data if not already set
  // biome-ignore lint/correctness/useExhaustiveDependencies: schema is intentionally excluded to only set once when not already set
  useEffect(() => {
    if (nodeData.structured_output?.schema && !schema) {
      setSchema(nodeData.structured_output.schema as SchemaRoot)
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
        draft.prompt_template = [{ role: PromptRole.SYSTEM, text: '' }]
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
      draft.prompt_template.push({ role: PromptRole.USER, text: '', editorContent: undefined })
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

  // Tools update handler
  const updateTools = (updates: Partial<AiNodeData['tools']>) => {
    const newData = produce(nodeData, (draft: AiNodeData) => {
      if (!draft.tools) {
        draft.tools = {
          enabled: false,
          allowedNodeIds: [],
          allowedBuiltInTools: [],
          maxConcurrentTools: 5,
          autoInvoke: true,
        }
      }
      Object.assign(draft.tools, updates)
    })
    setNodeData(newData)
  }

  // Get tools count for display
  const getToolsCount = () => {
    const nodeTools = nodeData.tools?.allowedNodeIds?.length || 0
    const builtInTools = nodeData.tools?.allowedBuiltInTools?.length || 0
    return nodeTools + builtInTools
  }

  // Get enabled tools for display with credential status
  const getEnabledTools = () => {
    const tools: Array<{
      id: string
      name: string
      type: 'node' | 'builtin'
      nodeType?: string
      credentialStatus?: ReturnType<typeof getToolCredentialStatus>
      hasCredentialIssue: boolean
    }> = []

    // Add workflow node tools
    if (nodeData.tools?.allowedNodeIds && nodes && Array.isArray(nodes)) {
      nodeData.tools.allowedNodeIds.forEach((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId)
        if (node) {
          const credentialId = nodeData.tools?.toolCredentials?.[nodeId]
          const credentialStatus = getToolCredentialStatus(
            nodeId,
            'workflow_node',
            node.type,
            credentialId
          )

          tools.push({
            id: nodeId,
            name: node.data?.title || `${node.type} ${nodeId}`,
            type: 'node',
            nodeType: node.type,
            credentialStatus,
            hasCredentialIssue: hasCredentialIssue(
              nodeId,
              'workflow_node',
              node.type,
              credentialId
            ),
          })
        }
      })
    }

    // Add built-in tools
    if (nodeData.tools?.allowedBuiltInTools) {
      const builtInNames: Record<string, string> = {
        http_request: 'HTTP Request',
        assign_variable: 'Assign Variable',
      }

      nodeData.tools.allowedBuiltInTools.forEach((toolId) => {
        const credentialId = nodeData.tools?.toolCredentials?.[toolId]
        const credentialStatus = getToolCredentialStatus(
          toolId,
          'built_in',
          undefined,
          credentialId
        )

        tools.push({
          id: toolId,
          name: builtInNames[toolId] || toolId,
          type: 'builtin',
          credentialStatus,
          hasCredentialIssue: hasCredentialIssue(toolId, 'built_in', undefined, credentialId),
        })
      })
    }

    return tools
  }

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
          {(nodeData.prompt_template || [{ role: PromptRole.SYSTEM, text: '' }]).map(
            (template: PromptTemplate, index: number) => (
              <Editor
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
                value={template.text || ''}
                onChange={(value) => {
                  // Store both the original editor content and the preprocessed text
                  updatePromptTemplate(index, { text: value })
                }}
                placeholder='Use { for variables'
                nodeId={nodeId}
                includeEnvironment
                includeSystem
                showRemove={index > 0}
                onRemove={() => removePromptTemplate(index)}
                minHeight={index === 0 ? 200 : 56}
                key={index}
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

      <Section
        title='Tools'
        description='Allow AI to use other nodes and built-in functions as tools'
        showEnable
        onEnableChange={(enabled) => updateTools({ enabled })}
        enabled={nodeData.tools?.enabled || false}
        initialOpen={nodeData.tools?.enabled || false}>
        <div className='space-y-3'>
          {/* Tools List */}
          {nodeData.tools?.enabled && (
            <>
              <div className='flex items-center justify-between'>
                <div className='text-xs text-muted-foreground'>
                  Available Tools ({getToolsCount()})
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setToolsDialogOpen(true)}
                  disabled={isReadOnly}>
                  <Plus className='h-3 w-3 mr-1' />
                  Add Tools
                </Button>
              </div>

              {/* Tools Display */}
              <div className='space-y-2'>
                {getEnabledTools().map((tool) => (
                  <div
                    key={tool.id}
                    className={cn(
                      'flex items-center justify-between p-2 bg-muted rounded-md',
                      tool.hasCredentialIssue && 'border border-destructive/50 bg-destructive/5'
                    )}>
                    <div className='flex items-center gap-2'>
                      <Wrench className='h-3 w-3 text-muted-foreground' />
                      <span className='text-xs font-medium'>{tool.name}</span>
                      <Badge
                        variant={tool.type === 'node' ? 'outline' : 'secondary'}
                        className='text-xs'>
                        {tool.type === 'node' ? 'Workflow' : 'Built-in'}
                      </Badge>
                      {tool.credentialStatus?.statusText && (
                        <CredentialStatusBadge
                          toolId={tool.id}
                          toolType={tool.type === 'node' ? 'workflow_node' : 'built_in'}
                          nodeType={tool.nodeType}
                          currentCredential={nodeData.tools?.toolCredentials?.[tool.id]}
                        />
                      )}
                    </div>

                    <div className='flex items-center gap-1'>
                      {tool.hasCredentialIssue && (
                        <Button
                          variant='ghost'
                          size='xs'
                          onClick={() => setToolsDialogOpen(true)}
                          className='text-destructive'>
                          <AlertTriangle className='h-3 w-3' />
                        </Button>
                      )}

                      {!isReadOnly && (
                        <Button
                          variant='ghost'
                          size='xs'
                          onClick={() => {
                            if (tool.type === 'node') {
                              const newNodeIds =
                                nodeData.tools?.allowedNodeIds?.filter((id) => id !== tool.id) || []
                              updateTools({ allowedNodeIds: newNodeIds })
                            } else {
                              const newBuiltInTools =
                                nodeData.tools?.allowedBuiltInTools?.filter(
                                  (id) => id !== tool.id
                                ) || []
                              updateTools({ allowedBuiltInTools: newBuiltInTools })
                            }
                          }}>
                          <X className='h-3 w-3' />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {getToolsCount() === 0 && (
                  <div className='text-center py-4 text-xs text-muted-foreground'>
                    No tools configured. Click "Add Tools" to get started.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Section>

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
                      ({Object.keys(schema.properties || {}).length} fields)
                    </span>
                  )}
                </div>
                <Button variant='outline' size='xs' onClick={() => setIsOpen(true)}>
                  <Pencil />
                </Button>
              </div>

              {/* Use the updated StructuredOutputGenerator that supports both */}
              <StructuredOutputGenerator
                isShow={isOpen}
                defaultSchema={schema}
                onSave={(newSchema) => {
                  console.log('save', newSchema)
                  setSchema(newSchema)
                  // Update the config with schema only
                  const newData = produce(nodeData, (draft: AiNodeData) => {
                    if (!draft.structured_output) {
                      draft.structured_output = { enabled: false }
                    }
                    draft.structured_output.enabled = true
                    draft.structured_output.schema = newSchema
                  })
                  setNodeData(newData)
                }}
                onClose={() => setIsOpen(false)}
              />
            </div>
          )}
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={aiDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />

      {/* Tools Selection Dialog */}
      <ToolsSelectionDialog
        isOpen={toolsDialogOpen}
        onClose={() => setToolsDialogOpen(false)}
        currentConfig={
          nodeData.tools || {
            enabled: false,
            allowedNodeIds: [],
            allowedBuiltInTools: [],
            maxConcurrentTools: 5,
            autoInvoke: true,
          }
        }
        onSave={(toolsConfig) => updateTools(toolsConfig)}
        nodeId={nodeId}
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

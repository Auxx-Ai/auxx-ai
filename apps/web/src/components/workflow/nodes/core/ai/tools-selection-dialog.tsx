// apps/web/src/components/workflow/nodes/core/ai/tools-selection-dialog.tsx

'use client'

import React, { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Switch } from '@auxx/ui/components/switch'
import { Wrench, Globe, Database, Search, Type, Variable, Code, Calendar } from 'lucide-react'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import type { AiToolsConfig } from './types'
import { CredentialStatusIndicator, hasCredentialIssue } from './tool-credential-status'
import { InlineToolCredentialSelector } from './tool-credential-dialog'

interface ToolsSelectionDialogProps {
  isOpen: boolean
  onClose: () => void
  currentConfig: AiToolsConfig
  onSave: (config: AiToolsConfig) => void
  nodeId: string
}

// Built-in tools definitions
const BUILTIN_TOOLS = [
  {
    id: 'http_request',
    name: 'HTTP Request',
    description: 'Make HTTP requests to external APIs',
    icon: Globe,
    category: 'Communication',
  },
  {
    id: 'assign_variable',
    name: 'Assign Variable',
    description: 'Assign values to workflow variables',
    icon: Variable,
    category: 'Data',
  },
] as const

// Node type to tool mapping
const NODE_TYPE_TOOLS = {
  http: { icon: Globe, category: 'Communication', description: 'HTTP request' },
  crud: { icon: Database, category: 'Data', description: 'Database operations' },
  find: { icon: Search, category: 'Data', description: 'Search and find records' },
  'text-classifier': { icon: Type, category: 'Transform', description: 'Classify text content' },
  'information-extractor': {
    icon: Type,
    category: 'Transform',
    description: 'Extract information',
  },
  'var-assign': { icon: Variable, category: 'Data', description: 'Assign variables' },
  code: { icon: Code, category: 'Transform', description: 'Execute code' },
  'date-time': { icon: Calendar, category: 'Transform', description: 'Date/time operations' },
} as const

export function ToolsSelectionDialog({
  isOpen,
  onClose,
  currentConfig,
  onSave,
  nodeId,
}: ToolsSelectionDialogProps) {
  const nodes = useWorkflowStore((state) => state.nodes)
  const [config, setConfig] = useState<AiToolsConfig>(currentConfig)

  // Get available workflow nodes (excluding current AI node)
  const availableNodes = useMemo(() => {
    if (!nodes || !Array.isArray(nodes)) return []

    return nodes
      .filter((node) => node.id !== nodeId && Object.keys(NODE_TYPE_TOOLS).includes(node.type))
      .map((node) => ({
        id: node.id,
        name: node.data?.title || `${node.type} ${node.id}`,
        type: node.type,
        description:
          node.data?.desc ||
          NODE_TYPE_TOOLS[node.type as keyof typeof NODE_TYPE_TOOLS]?.description,
        icon: NODE_TYPE_TOOLS[node.type as keyof typeof NODE_TYPE_TOOLS]?.icon || Wrench,
        category: NODE_TYPE_TOOLS[node.type as keyof typeof NODE_TYPE_TOOLS]?.category || 'Other',
      }))
  }, [nodes, nodeId])

  const handleSave = () => {
    onSave(config)
    onClose()
  }

  const toggleBuiltInTool = (toolId: string) => {
    const currentTools = config.allowedBuiltInTools || []
    const newTools = currentTools.includes(toolId)
      ? currentTools.filter((id) => id !== toolId)
      : [...currentTools, toolId]

    setConfig((prev) => ({ ...prev, allowedBuiltInTools: newTools }))
  }

  const toggleWorkflowNode = (nodeId: string) => {
    const currentNodes = config.allowedNodeIds || []
    const newNodes = currentNodes.includes(nodeId)
      ? currentNodes.filter((id) => id !== nodeId)
      : [...currentNodes, nodeId]

    setConfig((prev) => ({ ...prev, allowedNodeIds: newNodes }))
  }

  // Credential management handlers
  const handleToolCredentialSelect = (toolId: string, credentialId: string) => {
    setConfig((prev) => ({
      ...prev,
      toolCredentials: { ...prev.toolCredentials, [toolId]: credentialId },
    }))
  }

  const getToolCredentialId = (toolId: string): string | undefined => {
    return config.toolCredentials?.[toolId]
  }

  // Check if tool is enabled
  const isToolEnabled = (toolId: string, toolType: 'workflow_node' | 'built_in') => {
    if (toolType === 'built_in') {
      return config.allowedBuiltInTools?.includes(toolId) || false
    } else {
      return config.allowedNodeIds?.includes(toolId) || false
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-0">
          <DialogTitle className="flex items-center gap-2">Select Tools</DialogTitle>
          <div className="text-sm text-muted-foreground">
            Available tools ({availableNodes.length + BUILTIN_TOOLS.length})
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Workflow Node Tools */}
          {availableNodes.map((node) => (
            <Card key={node.id} className="p-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <node.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-sm">{node.name}</div>
                      <div className="text-xs text-muted-foreground">{node.description}</div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {node.type}
                    </Badge>
                  </div>
                  <Switch
                    checked={isToolEnabled(node.id, 'workflow_node')}
                    onCheckedChange={() => toggleWorkflowNode(node.id)}
                  />
                </div>

                {/* Credential configuration for enabled tools */}
                {isToolEnabled(node.id, 'workflow_node') && (
                  <div className="flex items-center justify-between border-t pt-3">
                    <CredentialStatusIndicator
                      toolId={node.id}
                      toolType="workflow_node"
                      nodeType={node.type}
                      currentCredential={getToolCredentialId(node.id)}
                    />
                    <InlineToolCredentialSelector
                      toolId={node.id}
                      toolName={node.name}
                      toolType="workflow_node"
                      nodeType={node.type}
                      currentCredentialId={getToolCredentialId(node.id)}
                      onCredentialSelect={(credentialId) =>
                        handleToolCredentialSelect(node.id, credentialId)
                      }
                    />
                  </div>
                )}
              </div>
            </Card>
          ))}

          {/* Built-in Tools */}
          {BUILTIN_TOOLS.map((tool) => (
            <Card key={tool.id} className="p-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <tool.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-sm">{tool.name}</div>
                      <div className="text-xs text-muted-foreground">{tool.description}</div>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {tool.category}
                    </Badge>
                  </div>
                  <Switch
                    checked={isToolEnabled(tool.id, 'built_in')}
                    onCheckedChange={() => toggleBuiltInTool(tool.id)}
                  />
                </div>

                {/* Credential configuration for enabled tools */}
                {isToolEnabled(tool.id, 'built_in') && (
                  <div className="flex items-center justify-between border-t pt-3">
                    <CredentialStatusIndicator
                      toolId={tool.id}
                      toolType="built_in"
                      currentCredential={getToolCredentialId(tool.id)}
                    />
                    <InlineToolCredentialSelector
                      toolId={tool.id}
                      toolName={tool.name}
                      toolType="built_in"
                      currentCredentialId={getToolCredentialId(tool.id)}
                      onCredentialSelect={(credentialId) =>
                        handleToolCredentialSelect(tool.id, credentialId)
                      }
                    />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} data-dialog-submit>
            Save <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

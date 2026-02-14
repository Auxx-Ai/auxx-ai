// apps/web/src/components/workflow/panels/tools-config-panel.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Separator } from '@auxx/ui/components/separator'
import { Switch } from '@auxx/ui/components/switch'
import { Wrench } from 'lucide-react'
import { useState } from 'react'
import type { AiToolsConfig } from '../nodes/core/ai/types'
import { useWorkflowStore } from '../store/workflow-store'

interface ToolsConfigPanelProps {
  nodeId: string
  toolsConfig?: AiToolsConfig
  onUpdate: (config: AiToolsConfig) => void
}

/**
 * Component for configuring AI node tools
 */
export function ToolsConfigPanel({ nodeId, toolsConfig, onUpdate }: ToolsConfigPanelProps) {
  const nodes = useWorkflowStore((state) => state.nodes)

  const [config, setConfig] = useState<AiToolsConfig>(
    toolsConfig || {
      enabled: false,
      allowedNodeIds: [],
      allowedBuiltInTools: [],
      maxConcurrentTools: 5,
      autoInvoke: true,
    }
  )

  // Get available workflow nodes (excluding current AI node and non-tool nodes)
  const availableNodes = nodes.filter(
    (node) =>
      node.id !== nodeId &&
      [
        'http',
        'crud',
        'find',
        'text-classifier',
        'information-extractor',
        'var-assign',
        'code',
        'date-time',
      ].includes(node.type)
  )

  // Built-in tools list
  const builtInTools = [
    {
      id: 'http_request',
      name: 'HTTP Request',
      description: 'Make HTTP requests to external APIs',
    },
    {
      id: 'assign_variable',
      name: 'Assign Variable',
      description: 'Assign values to workflow variables',
    },
  ]

  const handleConfigChange = (updates: Partial<AiToolsConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    onUpdate(newConfig)
  }

  const toggleNodeTool = (nodeId: string) => {
    const allowedNodeIds = config.allowedNodeIds || []
    const newAllowedIds = allowedNodeIds.includes(nodeId)
      ? allowedNodeIds.filter((id) => id !== nodeId)
      : [...allowedNodeIds, nodeId]

    handleConfigChange({ allowedNodeIds: newAllowedIds })
  }

  const toggleBuiltInTool = (toolId: string) => {
    const allowedTools = config.allowedBuiltInTools || []
    const newAllowedTools = allowedTools.includes(toolId)
      ? allowedTools.filter((id) => id !== toolId)
      : [...allowedTools, toolId]

    handleConfigChange({ allowedBuiltInTools: newAllowedTools })
  }

  return (
    <div className='space-y-6'>
      {/* Main Toggle */}
      <div className='flex items-center justify-between'>
        <div className='space-y-0.5'>
          <Label className='text-base font-medium flex items-center gap-2'>
            <Wrench className='h-4 w-4' />
            Enable Tools
          </Label>
          <p className='text-sm text-muted-foreground'>
            Allow AI to use workflow nodes and built-in functions as tools
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => handleConfigChange({ enabled })}
        />
      </div>

      {config.enabled && (
        <>
          <Separator />

          {/* Available Tools */}
          <Card>
            <CardHeader>
              <CardTitle className='text-sm'>Available Tools</CardTitle>
              <CardDescription>Select which tools the AI can use during execution</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {/* Workflow Node Tools */}
              {availableNodes.map((node) => (
                <div
                  key={node.id}
                  className='flex items-center justify-between p-2 border rounded-md'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <Badge variant='outline'>{node.type}</Badge>
                      <span className='text-sm font-medium'>{node.data?.title || node.id}</span>
                    </div>
                    {node.data?.desc && (
                      <p className='text-xs text-muted-foreground mt-1'>{node.data.desc}</p>
                    )}
                  </div>
                  <Switch
                    checked={config.allowedNodeIds?.includes(node.id) || false}
                    onCheckedChange={() => toggleNodeTool(node.id)}
                  />
                </div>
              ))}

              {/* Built-in Tools */}
              {builtInTools.map((tool) => (
                <div
                  key={tool.id}
                  className='flex items-center justify-between p-2 border rounded-md'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <Badge variant='secondary'>Built-in</Badge>
                      <span className='text-sm font-medium'>{tool.name}</span>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1'>{tool.description}</p>
                  </div>
                  <Switch
                    checked={config.allowedBuiltInTools?.includes(tool.id) || false}
                    onCheckedChange={() => toggleBuiltInTool(tool.id)}
                  />
                </div>
              ))}

              {availableNodes.length === 0 && builtInTools.length === 0 && (
                <p className='text-sm text-muted-foreground text-center py-4'>No tools available</p>
              )}
            </CardContent>
          </Card>

          {/* Advanced Settings */}
          <Card>
            <CardHeader>
              <CardTitle className='text-sm'>Advanced Settings</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label className='text-sm'>Max Concurrent Tools</Label>
                <Input
                  type='number'
                  min={1}
                  max={20}
                  value={config.maxConcurrentTools || 5}
                  onChange={(e) =>
                    handleConfigChange({ maxConcurrentTools: parseInt(e.target.value, 10) || 5 })
                  }
                />
                <p className='text-xs text-muted-foreground'>
                  Maximum number of tools that can run simultaneously
                </p>
              </div>

              <div className='flex items-center justify-between'>
                <div className='space-y-0.5'>
                  <Label className='text-sm'>Auto-invoke Tools</Label>
                  <p className='text-xs text-muted-foreground'>
                    Automatically execute tools or require manual approval
                  </p>
                </div>
                <Switch
                  checked={config.autoInvoke !== false}
                  onCheckedChange={(autoInvoke) => handleConfigChange({ autoInvoke })}
                />
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className='bg-muted/50'>
            <CardContent className='pt-4'>
              <div className='space-y-2'>
                <div className='flex items-center justify-between text-sm'>
                  <span>Available Tools:</span>
                  <Badge>
                    {(config.allowedNodeIds?.length || 0) +
                      (config.allowedBuiltInTools?.length || 0)}
                  </Badge>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span>Auto-invoke:</span>
                  <Badge variant={config.autoInvoke ? 'default' : 'secondary'}>
                    {config.autoInvoke ? 'Yes' : 'No'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export default ToolsConfigPanel

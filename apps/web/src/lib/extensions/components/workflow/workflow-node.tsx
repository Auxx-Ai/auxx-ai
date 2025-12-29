// apps/web/src/lib/extensions/components/workflow/workflow-node.tsx

import React from 'react'
import { useReactFlow } from '@xyflow/react'
import { cn } from '@auxx/ui/lib/utils'
import { WorkflowNodeProvider } from './workflow-node-context'
import { WorkflowNodeHandle } from './workflow-node-handle'

/** Configuration for automatic handle injection */
interface BlockAutoHandleConfig {
  /** Enable/disable auto-injection entirely */
  enabled?: boolean
  /** Configure target handle injection */
  target?:
    | boolean
    | {
        id?: string
        position?: 'left' | 'right' | 'top' | 'bottom'
      }
  /** Configure source handle injection */
  source?:
    | boolean
    | {
        id?: string
        position?: 'left' | 'right' | 'top' | 'bottom'
      }
}

/** Props for WorkflowNode component */
interface WorkflowNodeProps {
  /** Child elements to render inside the node */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Internal instance identifier passed from reconciler */
  __instanceId?: string
  /** React Flow node ID passed from platform */
  __reactFlowNodeId?: string
  /** Block configuration for auto-handle injection */
  __blockConfig?: BlockAutoHandleConfig
}

/**
 * Check if a React element is a WorkflowNodeHandle of specific type.
 */
function isHandleOfType(element: any, type: 'source' | 'target'): boolean {
  return (
    React.isValidElement(element) &&
    (element.type === WorkflowNodeHandle ||
      element.type?.name === 'WorkflowNodeHandle' ||
      // Handle serialized components from reconciler
      (element as any)?.component === 'WorkflowNodeHandle') &&
    element.props?.type === type
  )
}

/**
 * Analyze children to detect existing handles.
 */
function analyzeHandles(children: React.ReactNode) {
  const childArray = React.Children.toArray(children)

  const hasTargetHandle = childArray.some((child) => isHandleOfType(child, 'target'))
  const hasSourceHandle = childArray.some((child) => isHandleOfType(child, 'source'))

  return { hasTargetHandle, hasSourceHandle }
}

/**
 * Determine if auto-injection should occur based on node type.
 */
function getDefaultAutoHandleConfig(nodeType: string): BlockAutoHandleConfig {
  // Start nodes: only source handle
  if (nodeType === 'start' || nodeType === 'trigger') {
    return {
      enabled: true,
      target: false,
      source: true,
    }
  }

  // End nodes: only target handle
  if (nodeType === 'end' || nodeType === 'terminate') {
    return {
      enabled: true,
      target: true,
      source: false,
    }
  }

  // Display-only nodes: no handles
  if (nodeType === 'note' || nodeType === 'comment') {
    return {
      enabled: false,
    }
  }

  // Default: both handles
  return {
    enabled: true,
    target: true,
    source: true,
  }
}

/**
 * Merge block config with defaults.
 */
function mergeHandleConfig(
  nodeType: string,
  blockConfig?: BlockAutoHandleConfig
): BlockAutoHandleConfig {
  const defaults = getDefaultAutoHandleConfig(nodeType)

  if (!blockConfig) return defaults

  return {
    enabled: blockConfig.enabled ?? defaults.enabled,
    target: blockConfig.target ?? defaults.target,
    source: blockConfig.source ?? defaults.source,
  }
}

/**
 * Inject missing handles into children array.
 */
function injectMissingHandles(
  children: React.ReactNode,
  config: BlockAutoHandleConfig,
  { hasTargetHandle, hasSourceHandle }: ReturnType<typeof analyzeHandles>
): React.ReactNode {
  if (!config.enabled) return children

  let childArray = React.Children.toArray(children)

  // Inject target handle at the beginning if needed
  if (!hasTargetHandle && config.target) {
    const targetConfig = typeof config.target === 'object' ? config.target : {}
    const targetHandle = (
      <WorkflowNodeHandle
        key="__auto-target"
        type="target"
        id={targetConfig.id || 'target'}
        position={targetConfig.position || 'left'}
        className="auto-injected"
      />
    )
    childArray = [targetHandle, ...childArray]
  }

  // Inject source handle at the end if needed
  if (!hasSourceHandle && config.source) {
    const sourceConfig = typeof config.source === 'object' ? config.source : {}
    const sourceHandle = (
      <WorkflowNodeHandle
        key="__auto-source"
        type="source"
        id={sourceConfig.id || 'source'}
        position={sourceConfig.position || 'right'}
        className="auto-injected"
      />
    )
    childArray = [...childArray, sourceHandle]
  }

  return childArray
}

/**
 * WorkflowNode component with automatic handle injection.
 * Container for node visualization on canvas.
 * Provides context for child components to access node data.
 * Automatically injects missing connection handles.
 */
export const WorkflowNode = ({
  children,
  className,
  __instanceId,
  __reactFlowNodeId,
  __blockConfig,
}: WorkflowNodeProps) => {
  const { getNode } = useReactFlow()

  // Get node data from React Flow using the React Flow node ID (not reconciler instance ID)
  const node = __reactFlowNodeId ? getNode(__reactFlowNodeId) : null

  const contextValue = node
    ? {
        nodeId: node.id,
        nodeType: node.type || 'unknown',
        nodeData: node.data,
        position: node.position,
      }
    : null

  // Analyze existing handles
  const handleAnalysis = analyzeHandles(children)

  // Determine auto-handle configuration
  const nodeType = node?.type || 'unknown'
  const handleConfig = mergeHandleConfig(nodeType, __blockConfig)

  // Inject missing handles
  const enhancedChildren = injectMissingHandles(children, handleConfig, handleAnalysis)

  // Development mode logging
  if (process.env.NODE_ENV === 'development') {
    const injected = []
    if (!handleAnalysis.hasTargetHandle && handleConfig.target) {
      injected.push('target')
    }
    if (!handleAnalysis.hasSourceHandle && handleConfig.source) {
      injected.push('source')
    }

    if (injected.length > 0 && node) {
      console.info(
        `[WorkflowNode] Auto-injected ${injected.join(', ')} handle(s) for node type "${nodeType}"`,
        { nodeId: node.id, config: handleConfig }
      )
    }
  }

  return (
    <WorkflowNodeProvider value={contextValue}>
      <div
        className={cn(
          // 'min-w-[200px] rounded-lg border border-border bg-card text-card-foreground shadow-sm',
          className
        )}>
        {enhancedChildren}
      </div>
    </WorkflowNodeProvider>
  )
}

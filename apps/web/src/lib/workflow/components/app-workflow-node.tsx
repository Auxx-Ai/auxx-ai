// apps/web/src/lib/workflow/components/app-workflow-node.tsx

'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNodeCrud } from '~/components/workflow/hooks/use-node-data-update'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import type { BaseNodeData } from '~/components/workflow/types'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle/source-handle'
import { NodeTargetHandle } from '~/components/workflow/ui/node-handle/target-handle'
import { reconstructReactTree } from '~/lib/extensions/reconstruct-react-tree'
import { useAppStore } from '~/lib/extensions/use-app-store'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'

/**
 * Node props from ReactFlow
 */
interface AppWorkflowNodeProps {
  id: string
  data: BaseNodeData & {
    appId?: string
    installationId?: string
    blockId?: string
  }
  selected?: boolean
}

/**
 * Wrapper component for rendering app workflow block nodes.
 *
 * This component:
 * 1. Requests the node visualization from the app's iframe
 * 2. Receives a serialized React tree
 * 3. Reconstructs and renders it within a BaseNode wrapper
 */
export const AppWorkflowNode = memo<AppWorkflowNodeProps>((props) => {
  const { id, data, selected } = props

  const { setInputs: setNodeData } = useNodeCrud(id, data)
  const appStore = useAppStore()
  const { appInstallations, isLoading } = useExtensionsContext()
  const [nodeComponent, setNodeComponent] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef(data)

  // Keep ref in sync with latest data
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Parse app metadata from data.type if not present in data
  // Backend sends nodes with type="appId:blockId" but without appId, installationId, blockId fields
  const { appId, blockId, installationId } = useMemo(() => {
    let appId = data.appId
    let blockId = data.blockId
    let installationId = data.installationId

    // Parse from type if not present
    if (!appId || !blockId) {
      const nodeType = data.type as string
      if (nodeType?.includes(':')) {
        const parts = nodeType.split(':')
        if (parts.length === 2) {
          appId = parts[0] // e.g., "y5yf1eh8lr1ifedutbypg0vf"
          blockId = parts[1] // e.g., "send-email"
        }
      }
    }

    // Look up installationId if not present
    if (!installationId && appId) {
      const installation = appInstallations.find((i) => i.app.id === appId)
      installationId = installation?.installationId
    }

    return { appId, blockId, installationId }
  }, [data.appId, data.blockId, data.installationId, data.type, appInstallations.length, id])
  // Note: Changed from appInstallations to appInstallations.length to prevent mass rerenders

  // Persist resolved metadata back to node data so it survives save/load cycles
  useEffect(() => {
    // Check if we resolved any metadata that's not in data
    const needsUpdate =
      (appId && appId !== data.appId) ||
      (blockId && blockId !== data.blockId) ||
      (installationId && installationId !== data.installationId)

    if (needsUpdate) {
      // Build update object with only the fields that changed
      const updates: Record<string, string> = {}
      if (appId && appId !== data.appId) updates.appId = appId
      if (blockId && blockId !== data.blockId) updates.blockId = blockId
      if (installationId && installationId !== data.installationId) {
        updates.installationId = installationId
      }

      // Persist resolved metadata back to node data
      setNodeData({
        ...data,
        ...updates,
      })
    }
  }, [appId, blockId, installationId, data, setNodeData])

  useEffect(() => {
    // Request node component from iframe
    const loadNodeComponent = async () => {
      // Don't proceed if extensions are still loading
      if (isLoading) {
        return
      }

      if (!appId || !installationId || !blockId) {
        setError('Missing app metadata')
        return
      }

      const messageClient = appStore.getMessageClient({
        appId,
        appInstallationId: installationId,
      })

      if (!messageClient) {
        setError('App not loaded')
        return
      }

      try {
        // Wait for client to be ready
        await messageClient.waitUntilReady()

        // Request the node visualization
        const requestPayload = { blockId, nodeId: id, data: dataRef.current }
        const result = await messageClient.sendRequest<{ component: any }>(
          'render-workflow-node',
          requestPayload
        )

        if (result?.component) {
          setNodeComponent(result.component)
          setError(null)
        } else {
          setError('No component returned')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      }
    }

    loadNodeComponent()
  }, [appId, installationId, blockId, id, appStore, isLoading])
  // ↑ NO data dependency!

  // Listen for reactive updates from iframe
  useEffect(() => {
    if (!appId || !installationId) {
      return
    }

    const messageClient = appStore.getMessageClient({
      appId,
      appInstallationId: installationId,
    })

    if (!messageClient) {
      return
    }

    const unsubscribe = messageClient.listenForRequest(
      'workflow-node-updated',
      (updateData: any) => {
        if (updateData.nodeId === id) {
          // Store raw component data - will be reconstructed in renderComponent
          setNodeComponent(updateData.component)
        }
      }
    )

    return unsubscribe
  }, [appId, installationId, id, appStore])

  // Send data updates to iframe when React Flow data changes
  useEffect(() => {
    if (!nodeComponent) return // Wait for initial render
    if (!appId || !installationId) return

    const messageClient = appStore.getMessageClient({
      appId,
      appInstallationId: installationId,
    })

    if (!messageClient) return

    // Send updated data to node iframe
    void messageClient.sendRequest(`update-node-data-${id}`, dataRef.current)
  }, [data, id, appId, installationId, appStore])
  // CRITICAL: No nodeComponent in deps - only trigger on data changes from React Flow

  // Listen for data updates from iframe (bidirectional sync)
  useEffect(() => {
    if (!appId || !installationId) {
      return
    }

    const messageClient = appStore.getMessageClient({
      appId,
      appInstallationId: installationId,
    })

    if (!messageClient) {
      return
    }

    // Subscribe to workflow node data updates from iframe
    const unsubscribe = messageClient.listenForRequest(
      'workflow-node-data-update',
      (updateData: any) => {
        if (updateData.nodeId === id) {
          // Note: Updates are handled through React Flow store via panel
        }
      }
    )

    return unsubscribe
  }, [appId, installationId, id, appStore])

  /**
   * Extract unique handle IDs from connection data
   */
  const uniqueHandles = useMemo(() => {
    const targetHandles = [...new Set(data._connectedTargetHandleIds || [])]
    const sourceHandles = [...new Set(data._connectedSourceHandleIds || [])]
    return { targetHandles, sourceHandles }
  }, [data._connectedTargetHandleIds, data._connectedSourceHandleIds])

  /**
   * Render fallback handles when app is not loaded.
   * Uses edge connection data from node data to render the necessary handles.
   */
  const renderFallbackHandles = useCallback(() => {
    const { targetHandles, sourceHandles } = uniqueHandles

    return (
      <>
        {/* Render target handles (left side) */}
        {targetHandles.map((handleId) => (
          <NodeTargetHandle
            key={`target-${handleId}`}
            id={id}
            data={data}
            handleId={handleId}
            position='left'
          />
        ))}

        {/* Render source handles (right side) */}
        {sourceHandles.map((handleId) => (
          <NodeSourceHandle
            key={`source-${handleId}`}
            id={id}
            data={data}
            handleId={handleId}
            position='right'
            showAdd={false}
          />
        ))}
      </>
    )
  }, [uniqueHandles, id, data])

  // Render reconstructed component with error handling
  const renderComponent = () => {
    if (!nodeComponent) {
      return <div className='text-xs text-muted-foreground'>Loading...</div>
    }
    if (!nodeComponent.children || !Array.isArray(nodeComponent.children)) {
      return <div className='text-xs text-destructive'>Error: Invalid component structure</div>
    }

    if (nodeComponent.children.length === 0) {
      return <div className='text-xs text-muted-foreground'>No content to display</div>
    }

    // Try to reconstruct with error handling
    try {
      const reconstructed = reconstructReactTree(nodeComponent, {
        injectedProps: {
          // Pass React Flow node ID to WorkflowNode component
          __reactFlowNodeId: id,
        },
        onCallHandler: async (instanceId: number, eventName: string, ...args: any[]) => {
          const messageClient = appStore.getMessageClient({
            appId,
            appInstallationId: installationId!,
          })

          if (!messageClient) {
            throw new Error('Message client not available')
          }

          const result = await messageClient.sendRequest('call-instance-method', {
            instanceId,
            eventName,
            args,
          })

          if (result?.error) {
            throw new Error(result.error.message)
          }

          return result
        },
      })
      return reconstructed
    } catch (err) {
      return (
        <div className='text-xs text-destructive'>
          Reconstruction error: {err instanceof Error ? err.message : 'Unknown error'}
        </div>
      )
    }
  }

  return (
    <BaseNode id={id} data={data} selected={selected}>
      {/* Render fallback handles when there's an error */}
      {error && renderFallbackHandles()}

      <div className='space-y-1 pb-2'>
        {isLoading ? (
          <div className='text-xs text-muted-foreground'>Loading extensions...</div>
        ) : error ? (
          <div className='text-xs text-destructive'>Error: {error}</div>
        ) : (
          renderComponent()
        )}
      </div>
    </BaseNode>
  )
})

AppWorkflowNode.displayName = 'AppWorkflowNode'

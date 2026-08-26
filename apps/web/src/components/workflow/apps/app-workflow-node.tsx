// apps/web/src/components/workflow/apps/app-workflow-node.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { stableStringify } from '@auxx/utils/json'
import { useUpdateNodeInternals } from '@xyflow/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { useOptionalMessageClient } from '~/components/apps/runtime/hooks/use-optional-message-client'
import { reconstructReactTree } from '~/components/apps/runtime/reconstruct-react-tree'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { useNodeCrud } from '~/components/workflow/hooks/use-node-data-update'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import type { BaseNodeData } from '~/components/workflow/types'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle/source-handle'
import { NodeTargetHandle } from '~/components/workflow/ui/node-handle/target-handle'
import { useOptionalAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/**
 * Recursively check a serialized component tree for connection handles.
 * Trees without any WorkflowNodeHandle (e.g. the SDK's default text-only
 * node for blocks/triggers lacking a custom node component) need
 * platform-rendered handles or the node can never be connected.
 */
function treeHasHandles(component: any): boolean {
  if (!component || typeof component !== 'object') return false
  if (component.component === 'WorkflowNodeHandle') return true
  if (!Array.isArray(component.children)) return false
  return component.children.some(treeHasHandles)
}

/**
 * Node props from ReactFlow
 */
interface AppWorkflowNodeProps {
  id: string
  data: BaseNodeData & {
    appId?: string
    installationId?: string
    blockId?: string
    appSlug?: string
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
  const { appInstallations, isLoading } = useAppsContext()
  const [nodeComponent, setNodeComponent] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef(data)
  /** Last payload actually sent to the iframe, so an unchanged one is not re-sent. */
  const lastSentNodeDataRef = useRef<string | null>(null)
  const updateNodeInternals = useUpdateNodeInternals()

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

    // Resolve installationId at runtime — handles both missing and stale
    if (appId) {
      const isStale =
        installationId && !appInstallations.find((i) => i.installationId === installationId)
      if (!installationId || isStale) {
        const installation =
          appInstallations.find((i) => i.app.id === appId && i.installationType === 'production') ||
          appInstallations.find((i) => i.app.id === appId)
        installationId = installation?.installationId
      }
    }

    return { appId, blockId, installationId }
  }, [data.appId, data.blockId, data.installationId, data.type, appInstallations])

  // Detect "not installed" state: appSlug present but no installationId resolved
  const appSlug = data.appSlug as string | undefined
  const isNotInstalled = !isLoading && !!appId && !installationId && !!appSlug

  // The app's own avatar and title — `getBySlug` answers for uninstalled apps,
  // and without it the node falls back to the registry's generic `box` icon and
  // identifies nothing. Skipped entirely while the app is installed.
  const uninstalledApp = api.apps.getBySlug.useQuery(
    { appSlug: appSlug ?? '' },
    { enabled: isNotInstalled, retry: false, staleTime: 5 * 60 * 1000 }
  )

  // `apps.install` is `permissionProcedure(integrationsManage)` — a member
  // without it would click into a 403 toast. Unknown outside a
  // `CapabilitiesProvider` (the public viewer): stay visible, the server gates.
  const access = useOptionalAccess()
  const canInstall = access ? access.can(PermissionKey.integrationsManage) : true

  // Reactive message client — re-renders when client becomes available or errors
  const { messageClient, initError } = useOptionalMessageClient({
    appId,
    appInstallationId: installationId,
  })

  // Persist resolved metadata back to node data so it survives save/load cycles
  // Note: installationId is NOT persisted — it's a runtime concern (Approach B)
  useEffect(() => {
    const needsUpdate = (appId && appId !== data.appId) || (blockId && blockId !== data.blockId)

    if (needsUpdate) {
      const updates: Record<string, string> = {}
      if (appId && appId !== data.appId) updates.appId = appId
      if (blockId && blockId !== data.blockId) updates.blockId = blockId

      setNodeData({
        ...data,
        ...updates,
      })
    }
  }, [appId, blockId, data, setNodeData])

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

      // Wait for reactive client — will re-run when messageClient changes
      if (!messageClient) {
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
          // Force React Flow to re-measure handles now that the iframe component rendered
          updateNodeInternals(id)
        } else {
          setError('No component returned')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      }
    }

    loadNodeComponent()
  }, [appId, installationId, blockId, id, isLoading, messageClient])
  // ↑ NO data dependency! messageClient triggers re-run when client appears.

  // Listen for reactive updates from iframe
  useEffect(() => {
    if (!messageClient) {
      return
    }

    const unsubscribe = messageClient.listenForRequest(
      'workflow-node-updated',
      (updateData: any) => {
        if (updateData.nodeId === id) {
          // Store raw component data - will be reconstructed in renderComponent
          setNodeComponent(updateData.component)
          updateNodeInternals(id)
        }
      }
    )

    return unsubscribe
  }, [id, messageClient])

  // Send data updates to iframe when React Flow data changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodeComponent is intentionally excluded - only trigger on data changes from React Flow
  useEffect(() => {
    if (!nodeComponent) return // Wait for initial render
    if (!messageClient) return

    // Guarded on the serialized payload, not on `data`'s identity: the node
    // iframe `setData`s whatever arrives and re-renders, so re-sending bytes it
    // already holds buys a render per tick and nothing else (plan 29 §2).
    const payload = stableStringify(dataRef.current)
    if (payload === lastSentNodeDataRef.current) return
    lastSentNodeDataRef.current = payload

    // Send updated data to node iframe
    void messageClient.sendRequest(`update-node-data-${id}`, dataRef.current)
  }, [data, id, messageClient])
  // CRITICAL: No nodeComponent in deps - only trigger on data changes from React Flow

  // Listen for data updates from iframe (bidirectional sync)
  useEffect(() => {
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
  }, [id, messageClient])

  /**
   * Extract unique handle IDs from connection data
   */
  const uniqueHandles = useMemo(() => {
    const targetHandles = [...new Set(data._connectedTargetHandleIds || [])]
    const sourceHandles = [...new Set(data._connectedSourceHandleIds || [])]
    return { targetHandles, sourceHandles }
  }, [data._connectedTargetHandleIds, data._connectedSourceHandleIds])

  /**
   * Render fallback handles when the iframe component is unavailable or
   * doesn't declare its own handles.
   * Uses edge connection data when present; never-connected nodes get the
   * standard handle pair (source only for triggers) so they can be connected.
   */
  const isTriggerNode = unifiedNodeRegistry.isTrigger(data.type)
  const renderFallbackHandles = useCallback(() => {
    const { targetHandles, sourceHandles } = uniqueHandles
    const targets = targetHandles.length > 0 ? targetHandles : isTriggerNode ? [] : ['target']
    const sources = sourceHandles.length > 0 ? sourceHandles : ['source']

    return (
      <>
        {/* Render target handles (left side) */}
        {targets.map((handleId) => (
          <NodeTargetHandle
            key={`target-${handleId}`}
            id={id}
            data={data}
            handleId={handleId}
            position='left'
          />
        ))}

        {/* Render source handles (right side) */}
        {sources.map((handleId) => (
          <NodeSourceHandle
            key={`source-${handleId}`}
            id={id}
            data={data}
            handleId={handleId}
            position='right'
          />
        ))}
      </>
    )
  }, [uniqueHandles, id, data, isTriggerNode])

  // Derive display error from local error or init error — keep short for node display
  const displayError = error || initError ? 'Extension failed to load' : null

  // Render reconstructed component with error handling
  const renderComponent = () => {
    if (!nodeComponent) {
      return (
        <div className='px-3'>
          <div className='flex items-center h-6 rounded-md bg-muted px-2'>
            <div className='text-xs text-muted-foreground'>Loading...</div>
          </div>
        </div>
      )
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
    <BaseNode
      id={id}
      data={data}
      selected={selected}
      icon={
        isNotInstalled && uninstalledApp.data ? (
          <AppIcon iconId={uninstalledApp.data.app.avatarUrl ?? 'package'} size='default' />
        ) : undefined
      }>
      {/* Render fallback handles when the iframe component hasn't loaded yet,
          or when it loaded but declares no handles of its own (the SDK's
          default text-only node). Without this, such nodes have no handles
          and can never be connected. */}
      {(displayError || isNotInstalled || !nodeComponent || !treeHasHandles(nodeComponent)) &&
        renderFallbackHandles()}

      <div className='space-y-1 pb-2'>
        {isLoading ? (
          <div className='px-3'>
            <div className='flex items-center h-6 rounded-md bg-muted px-2'>
              <div className='text-xs text-muted-foreground'>Loading...</div>
            </div>
          </div>
        ) : isNotInstalled ? (
          // One row, like every other node body. The corner badge already says
          // something is wrong (the not-installed issue flows through
          // `useAppNodeIssueResolver`), and the panel carries the full story —
          // the node only needs the one affordance.
          <div className='px-3'>
            <div className='flex h-6 items-center justify-between gap-2'>
              <span className='truncate text-xs text-muted-foreground'>Not installed</span>
              {canInstall && appSlug && <InlineAppInstallButton appSlug={appSlug} />}
            </div>
          </div>
        ) : displayError ? (
          <div className='px-3'>
            <div className='relative flex items-center justify-between h-6 rounded-md bg-bad-50 px-2'>
              <div className='text-xs text-bad-600'>{displayError}</div>
            </div>
          </div>
        ) : (
          renderComponent()
        )}
      </div>
    </BaseNode>
  )
})

AppWorkflowNode.displayName = 'AppWorkflowNode'

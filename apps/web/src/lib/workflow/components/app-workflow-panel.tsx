// apps/web/src/lib/workflow/components/app-workflow-panel.tsx

'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { useNodeCrud } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { reconstructReactTree } from '~/lib/extensions/reconstruct-react-tree'
import { useAppStore } from '~/lib/extensions/use-app-store'
import type { WorkflowBlock } from '../types'

/**
 * Props for AppWorkflowPanel component
 */
interface AppWorkflowPanelProps {
  nodeId: string
  appId: string
  installationId: string
  block: WorkflowBlock
  data?: any // Optional data prop from parent
}

/**
 * Wrapper component for rendering app workflow block configuration panels.
 *
 * This component:
 * 1. Requests the panel UI from the app's iframe
 * 2. Receives a serialized React tree
 * 3. Reconstructs and renders it within a BasePanel wrapper
 * 4. Handles bidirectional data updates between platform and iframe
 */
export const AppWorkflowPanel = memo<AppWorkflowPanelProps>(
  ({ nodeId, appId, installationId, block, data: propData }) => {
    const appStore = useAppStore()
    // Initialize with actual node data from props instead of empty object
    const { inputs: nodeData, setInputs } = useNodeCrud(nodeId, propData || {})
    const nodeDataRef = useRef(nodeData)
    const [panelComponent, setPanelComponent] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Keep ref in sync with latest nodeData
    useEffect(() => {
      nodeDataRef.current = nodeData
    }, [nodeData])

    // Load panel component from iframe
    useEffect(() => {
      let isMounted = true

      // Reset states when loading starts
      setIsLoading(true)
      setPanelComponent(null)
      setError(null)

      const loadPanelComponent = async (retryCount = 0): Promise<void> => {
        const maxRetries = 3
        const retryDelay = Math.min(1000 * 2 ** retryCount, 5000) // Exponential backoff, max 5s

        const messageClient = appStore.getMessageClient({
          appId,
          appInstallationId: installationId,
        })

        if (!messageClient) {
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay))
            if (isMounted) {
              return loadPanelComponent(retryCount + 1)
            }
            return
          }
          console.error('[AppWorkflowPanel] Max retries reached - no message client')
          if (isMounted) {
            setError('App not loaded')
            setIsLoading(false)
          }
          return
        }

        try {
          // Wait for client to be ready
          await messageClient.waitUntilReady()

          // Request the panel UI
          const result = await messageClient.sendRequest<{ component: any }>(
            'render-workflow-panel',
            {
              blockId: block.id,
              nodeId,
              data: nodeDataRef.current, // Use ref for initial data
            }
          )

          if (!isMounted) return

          // Validate component structure
          if (result?.component) {
            // Check if it has the required structure for reconstructReactTree
            if (!result.component.children) {
              console.error(
                '[AppWorkflowPanel] Component missing children property:',
                result.component
              )
              setError('Invalid panel structure: missing children')
              setIsLoading(false)
              return
            }

            if (!Array.isArray(result.component.children)) {
              console.error(
                '[AppWorkflowPanel] Component children is not an array:',
                typeof result.component.children
              )
              setError('Invalid panel structure: children not an array')
              setIsLoading(false)
              return
            }

            setPanelComponent(result.component)
            setError(null)
            setIsLoading(false)
          } else {
            console.error('[AppWorkflowPanel] No component in result')
            setError('No component returned')
            setIsLoading(false)
          }
        } catch (err) {
          console.error('[AppWorkflowPanel] Error loading panel:', err)
          if (!isMounted) return

          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay))
            if (isMounted) {
              return loadPanelComponent(retryCount + 1)
            }
            return
          }

          console.error('[AppWorkflowPanel] Max retries reached after error:', err)
          setError(err instanceof Error ? err.message : 'Failed to load')
          setIsLoading(false)
        }
      }

      void loadPanelComponent()

      return () => {
        isMounted = false
      }
    }, [appId, installationId, block.id, nodeId, appStore])
    // ✓ nodeData removed - panel loads once, data flows through context

    // Listen for data updates from iframe
    // biome-ignore lint/correctness/useExhaustiveDependencies: setInputs is stable from useNodeCrud
    useEffect(() => {
      let unsubscribe: (() => void) | undefined
      let isMounted = true

      const setupListener = async () => {
        try {
          const messageClient = appStore.getMessageClient({
            appId,
            appInstallationId: installationId,
          })

          if (!messageClient) {
            setTimeout(() => isMounted && setupListener(), 500)
            return
          }

          // CRITICAL FIX: Wait for client to be ready
          await messageClient.waitUntilReady()

          if (!isMounted) return

          unsubscribe = messageClient.listenForRequest('workflow-node-data-update', (data: any) => {
            if (data.nodeId === nodeId) {
              setInputs({
                ...nodeDataRef.current,
                ...data.data,
              })
            }
          })
        } catch (error) {
          console.error('[AppWorkflowPanel] Setup error:', error)
          // Retry on error
          setTimeout(() => isMounted && setupListener(), 1000)
        }
      }

      setupListener()

      return () => {
        isMounted = false
        unsubscribe?.()
      }
    }, [appId, installationId, nodeId, appStore])

    // Listen for reactive updates from iframe
    useEffect(() => {
      const messageClient = appStore.getMessageClient({
        appId,
        appInstallationId: installationId,
      })

      if (!messageClient) return

      const unsubscribe = messageClient.listenForRequest('workflow-panel-updated', (data: any) => {
        if (data.nodeId === nodeId) {
          // Store raw component data - will be reconstructed in render
          setPanelComponent(data.component)
        }
      })

      return unsubscribe
    }, [appId, installationId, nodeId, appStore])

    // Send data updates to iframe when React Flow data changes
    // biome-ignore lint/correctness/useExhaustiveDependencies: panelComponent is intentionally excluded - only send when nodeData changes
    useEffect(() => {
      if (!panelComponent) return // Wait for initial render

      const messageClient = appStore.getMessageClient({
        appId,
        appInstallationId: installationId,
      })

      if (!messageClient) return

      void messageClient.sendRequest(`update-panel-data-${nodeId}`, nodeDataRef.current)
    }, [nodeData, nodeId, appId, installationId, appStore])
    // Note: panelComponent removed from deps - only send when nodeData changes, not on reactive updates

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        const messageClient = appStore.getMessageClient({
          appId,
          appInstallationId: installationId,
        })

        if (messageClient) {
          void messageClient.sendMessage('cleanup-panel-render', { nodeId })
        }
      }
    }, [nodeId, appId, installationId, appStore])

    return (
      <BasePanel title={block.label} nodeId={nodeId} data={nodeData}>
        {isLoading ? (
          <div className='p-4'>
            <div className='text-sm text-muted-foreground'>Loading configuration...</div>
          </div>
        ) : error ? (
          <div className='p-4'>
            <div className='text-sm text-destructive'>Error loading configuration: {error}</div>
          </div>
        ) : panelComponent ? (
          <>
            {reconstructReactTree(panelComponent, {
              onCallHandler: async (instanceId: number, eventName: string, ...args: any[]) => {
                const messageClient = appStore.getMessageClient({
                  appId,
                  appInstallationId: installationId,
                })

                if (!messageClient) {
                  console.error('[AppWorkflowPanel] No message client for event call')
                  throw new Error('Message client not available')
                }

                const result = await messageClient.sendRequest('call-instance-method', {
                  instanceId,
                  eventName,
                  args,
                })

                if (result?.error) {
                  console.error('[AppWorkflowPanel] Event handler error:', result.error)
                  throw new Error(result.error.message)
                }

                return result
              },
            })}
            <OutputVariablesDisplay
              outputs={block.schema.outputs}
              nodeId={nodeId}
              initialOpen={false}
            />
          </>
        ) : (
          <div className='p-4'>
            <div className='text-sm text-muted-foreground'>No panel available</div>
          </div>
        )}
      </BasePanel>
    )
  }
)

AppWorkflowPanel.displayName = 'AppWorkflowPanel'

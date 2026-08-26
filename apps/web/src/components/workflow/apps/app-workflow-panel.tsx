// apps/web/src/components/workflow/apps/app-workflow-panel.tsx

'use client'

import { stableStringify } from '@auxx/utils/json'
import { deepEqual } from '@auxx/utils/objects'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { suppressConnectionDialog } from '~/components/apps/runtime/connection-dialog-suppression'
import { useOptionalMessageClient } from '~/components/apps/runtime/hooks/use-optional-message-client'
import { reconstructReactTree } from '~/components/apps/runtime/reconstruct-react-tree'
import { AppTriggerTestSection } from '~/components/workflow/apps/trigger/app-trigger-test-section'
import { useNodeCrud } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import type { WorkflowBlock } from '~/components/workflow/types/block-types'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { collectHiddenFields } from '~/components/workflow/utils/collect-hidden-fields'
import { convertOutputFieldsToVariables } from '~/components/workflow/utils/type-mapping'
import { AppNodeFallbackPanel } from './app-node-fallback-panel'
import { AppPollingSection } from './app-polling-section'
import { AppWorkflowFieldContext } from './app-workflow-field-context'
import { computeOutputSignature, resolveAppBlockOutputFields } from './resolve-app-outputs'

/**
 * Props for AppWorkflowPanel component
 */
interface AppWorkflowPanelProps {
  nodeId: string
  appId: string
  installationId: string
  block: WorkflowBlock
  data?: any // Optional data prop from parent
  /** Whether this node is a trigger (disables variable mode on inputs) */
  isTrigger?: boolean
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
  ({ nodeId, appId, installationId, block, data: propData, isTrigger = false }) => {
    const { appInstallations } = useAppsContext()

    // Resolve app context — handles both exact match and fallback from appId
    const appContext = useMemo(() => {
      // Try exact match first (backwards compat with nodes that still have installationId)
      let inst = appInstallations.find(
        (i) => i.app.id === appId && i.installationId === installationId
      )
      // Fallback: resolve from appId (Approach B — installationId may be missing or stale)
      if (!inst && appId) {
        inst =
          appInstallations.find((i) => i.app.id === appId && i.installationType === 'production') ||
          appInstallations.find((i) => i.app.id === appId)
      }
      if (!inst) return undefined
      return {
        appId,
        appSlug: inst.app.slug,
        installationId: inst.installationId,
        installationType: inst.installationType,
        appName: inst.app.title,
      }
    }, [appId, installationId, appInstallations])

    // Check for "not installed" state — appSlug present on node data but no installation found
    const nodeAppSlug = propData?.appSlug as string | undefined
    const isNotInstalled = !appContext && !!nodeAppSlug

    // Initialize with actual node data from props instead of empty object
    const { inputs: nodeData, setInputs } = useNodeCrud(nodeId, propData || {})
    const nodeDataRef = useRef(nodeData)
    /** Last payload actually sent to the iframe, so an unchanged one is not re-sent. */
    const lastSentPanelDataRef = useRef<string | null>(null)
    const [panelComponent, setPanelComponent] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Reactive message client — use resolved installationId from appContext
    const resolvedInstallationId = appContext?.installationId ?? installationId
    const { messageClient, initError } = useOptionalMessageClient({
      appId,
      appInstallationId: resolvedInstallationId,
    })

    // Keep ref in sync with latest nodeData
    useEffect(() => {
      nodeDataRef.current = nodeData
    }, [nodeData])

    // Suppress the global connection-expired modal while editing this app node's
    // config. The panel auto-loads field options via server functions; an
    // expired connection shouldn't pop an unprompted dialog here. Status is
    // still shown via the App Settings dot, and run/test use a separate path.
    useEffect(() => suppressConnectionDialog(resolvedInstallationId), [resolvedInstallationId])

    /**
     * Handle field value changes from VarEditor-backed input components.
     * Writes the raw value and field mode directly to ReactFlow node data.
     */
    const handleFieldChange = useCallback(
      (fieldKey: string, value: any, isConstantMode: boolean) => {
        setInputs({
          ...nodeDataRef.current,
          [fieldKey]: value,
          fieldModes: {
            ...(nodeDataRef.current.fieldModes || {}),
            [fieldKey]: isConstantMode,
          },
        })
      },
      [setInputs]
    )

    /**
     * Get the current mode for a field.
     * Returns true (constant) by default — safe for existing nodes without fieldModes.
     */
    const getFieldMode = useCallback(
      (fieldKey: string): boolean => {
        return nodeData.fieldModes?.[fieldKey] !== false
      },
      [nodeData.fieldModes]
    )

    /** Handle connection picker change — write connectionId to node data */
    const handleConnectionChange = useCallback(
      (connectionId: string | undefined) => {
        setInputs({
          ...nodeDataRef.current,
          connectionId,
        })
      },
      [setInputs]
    )

    // App context for BasePanel's App Settings account popover — extends the
    // resolved installation with the node's bound connection so picking an
    // account writes back to node data.
    const basePanelAppContext = useMemo(
      () =>
        appContext
          ? {
              ...appContext,
              connectionId: nodeData.connectionId as string | undefined,
              onConnectionChange: handleConnectionChange,
            }
          : undefined,
      [appContext, nodeData.connectionId, handleConnectionChange]
    )

    /** Context value for AppWorkflowFieldContext */
    // biome-ignore lint/correctness/useExhaustiveDependencies: nodeData changes drive re-computation
    const fieldContextValue = useMemo(
      () => ({
        nodeId,
        nodeData,
        handleFieldChange,
        getFieldMode,
        schema: block.schema,
        isTrigger,
        setInputs,
      }),
      [nodeId, nodeData, handleFieldChange, getFieldMode, block.schema, isTrigger, setInputs]
    )

    /** Merged output variables (static + computed + inferred from execution) */
    const mergedOutputVariables = useMemo(() => {
      const merged = resolveAppBlockOutputFields(block, nodeData)
      return convertOutputFieldsToVariables(merged, nodeId)
    }, [block, nodeData._computedOutputs, nodeData.inferredSchema, nodeId])

    // Load panel component from iframe
    useEffect(() => {
      let isMounted = true

      // Reset states when loading starts
      setIsLoading(true)
      setPanelComponent(null)
      setError(null)

      const loadPanelComponent = async (): Promise<void> => {
        // Wait for reactive client — will re-run when messageClient changes
        if (!messageClient) {
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
          setError(err instanceof Error ? err.message : 'Failed to load')
          setIsLoading(false)
        }
      }

      void loadPanelComponent()

      return () => {
        isMounted = false
      }
    }, [appId, installationId, block.id, nodeId, messageClient])
    // ✓ nodeData removed - panel loads once, data flows through context
    // ✓ messageClient in deps - re-runs when client becomes available

    // Listen for data updates from iframe
    // biome-ignore lint/correctness/useExhaustiveDependencies: setInputs is stable from useNodeCrud
    useEffect(() => {
      if (!messageClient) return

      let unsubscribeData: (() => void) | undefined
      let unsubscribeOutputs: (() => void) | undefined
      let isMounted = true

      const setupListener = async () => {
        try {
          // Wait for client to be ready
          await messageClient.waitUntilReady()

          if (!isMounted) return

          // An iframe re-render re-sends the block's data whether or not any of
          // it moved, so this echoes back values we already hold. Writing them
          // anyway mints a new `node.data` identity, which pushes data back
          // INTO the iframe and starts the cycle again — plan 29 §2 link H1.
          unsubscribeData = messageClient.listenForRequest(
            'workflow-node-data-update',
            (data: any) => {
              if (data.nodeId !== nodeId) return
              const merged = { ...nodeDataRef.current, ...data.data }
              if (deepEqual(merged, nodeDataRef.current)) return
              setInputs(merged)
            }
          )

          // Listen for dynamic output updates from SDK-side computeOutputs.
          // `evaluateComputeOutputs` re-runs on every panel render and emits
          // unconditionally, so identical outputs arrive ~1/s forever; the
          // signature comparison below already existed but only gated the
          // `inferredSchema` clear, not the write itself.
          unsubscribeOutputs = messageClient.listenForRequest(
            'workflow-block-outputs-updated',
            (data: any) => {
              if (data.nodeId !== nodeId) return

              const prevSig = computeOutputSignature(nodeDataRef.current._computedOutputs || {})
              const newSig = computeOutputSignature(data.outputs || {})

              // Same shape AND same values: nothing to record. The signature
              // alone is not enough — it captures field types and nesting, not
              // the values, so two different output sets can share one.
              if (
                prevSig === newSig &&
                deepEqual(data.outputs, nodeDataRef.current._computedOutputs)
              ) {
                return
              }

              const updates: any = {
                ...nodeDataRef.current,
                _computedOutputs: data.outputs,
              }

              // Clear stale inferred schema if computed output shape changed
              if (prevSig !== newSig && nodeDataRef.current.inferredSchema) {
                updates.inferredSchema = undefined
              }

              setInputs(updates)
            }
          )
        } catch (error) {
          console.error('[AppWorkflowPanel] Setup error:', error)
        }
      }

      setupListener()

      return () => {
        isMounted = false
        unsubscribeData?.()
        unsubscribeOutputs?.()
      }
    }, [nodeId, messageClient])

    // Listen for reactive updates from iframe
    useEffect(() => {
      if (!messageClient) return

      const unsubscribe = messageClient.listenForRequest('workflow-panel-updated', (data: any) => {
        if (data.nodeId === nodeId) {
          // Store raw component data - will be reconstructed in render
          setPanelComponent(data.component)
        }
      })

      return unsubscribe
    }, [nodeId, messageClient])

    // Track which input fields are currently hidden by a ConditionalRender so
    // the single-node Input tab and variable extraction can ignore stale values
    // from fields that don't apply to the active operation. Derived from the
    // rendered panel tree (the iframe already evaluated each condition) and
    // stashed under `_hiddenFields` — a `_`-prefixed key, so it's ephemeral and
    // stripped on save. Absent for nodes whose panel was never opened.
    useEffect(() => {
      if (!panelComponent) return
      const hidden = collectHiddenFields(panelComponent)
      const prev = (nodeDataRef.current._hiddenFields as string[] | undefined) ?? []
      // Stable compare (collectHiddenFields returns sorted) to avoid update loops
      if (hidden.length === prev.length && hidden.every((f, i) => f === prev[i])) return
      setInputs({ ...nodeDataRef.current, _hiddenFields: hidden })
    }, [panelComponent, setInputs])

    // Send data updates to iframe when React Flow data changes.
    //
    // Guarded on the SERIALIZED payload, not on `nodeData`'s identity: the
    // iframe's own `setData` merges whatever arrives into new state and
    // re-renders, which re-runs its `computeOutputs` and emits back to us. A
    // re-push of bytes it already holds is therefore not free — it is the
    // return leg of plan 29 §2's cycle (link H3 → S3).
    // biome-ignore lint/correctness/useExhaustiveDependencies: panelComponent is intentionally excluded - only send when nodeData changes
    useEffect(() => {
      if (!panelComponent) return // Wait for initial render
      if (!messageClient) return

      const payload = stableStringify(nodeDataRef.current)
      if (payload === lastSentPanelDataRef.current) return
      lastSentPanelDataRef.current = payload

      void messageClient.sendRequest(`update-panel-data-${nodeId}`, nodeDataRef.current)
    }, [nodeData, nodeId, messageClient])
    // Note: panelComponent removed from deps - only send when nodeData changes, not on reactive updates

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (messageClient) {
          void messageClient.sendMessage('cleanup-panel-render', { nodeId })
        }
      }
    }, [nodeId, messageClient])

    // Derive display error from local error or init error
    const displayError =
      error || (initError ? `Extension failed to load: ${initError.message}` : null)

    // Reachable only when the app is uninstalled while this builder is open —
    // the block stays registered, so the registry still routes here. A cold
    // load of the same workflow never gets this far: with no registered panel,
    // `NodePanelBody` renders `AppNodeFallbackPanel` directly.
    if (isNotInstalled) {
      return <AppNodeFallbackPanel nodeId={nodeId} data={nodeData} />
    }

    return (
      <BasePanel
        title={block.label}
        nodeId={nodeId}
        data={nodeData}
        appContext={basePanelAppContext}>
        {isTrigger && block.config?.polling && (
          <AppPollingSection
            nodeId={nodeId}
            data={nodeData}
            defaultInterval={block.config.polling.intervalMinutes}
            minInterval={block.config.polling.minIntervalMinutes}
          />
        )}
        {isTrigger && !block.config?.polling && (
          <AppTriggerTestSection
            installationId={resolvedInstallationId}
            triggerId={block.id}
            schema={block.schema}
          />
        )}
        {isLoading && !displayError ? (
          <div className='p-4'>
            <div className='text-sm text-muted-foreground'>Loading configuration...</div>
          </div>
        ) : displayError ? (
          <div className='p-4'>
            <div className='text-sm text-destructive'>
              Error loading configuration: {displayError}
            </div>
          </div>
        ) : panelComponent ? (
          <>
            <AppWorkflowFieldContext.Provider value={fieldContextValue}>
              {reconstructReactTree(panelComponent, {
                onCallHandler: async (instanceId: number, eventName: string, ...args: any[]) => {
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
            </AppWorkflowFieldContext.Provider>
            <OutputVariablesDisplay
              outputVariables={mergedOutputVariables}
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

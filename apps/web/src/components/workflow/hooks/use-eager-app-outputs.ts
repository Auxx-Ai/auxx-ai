// apps/web/src/components/workflow/hooks/use-eager-app-outputs.ts

import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '~/lib/extensions/use-app-store'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { useVarStore } from '../store/use-var-store'
import type { NodeMeta } from '../store/var-graph'

/**
 * Eagerly fetches computed outputs for app nodes that don't have them yet.
 *
 * Problem: App node outputs (e.g., Shopify) are only computed by the iframe SDK
 * when the panel is opened. For fresh template installs, this means downstream
 * nodes can't see app outputs in the variable explorer until the user clicks
 * the app node.
 *
 * Solution: After blocks are registered and the graph is populated, detect app
 * nodes with empty outputs and request computed outputs from the iframe via
 * the `compute-workflow-node-outputs` message.
 */
export function useEagerAppOutputs() {
  const store = useStoreApi()
  const appStore = useAppStore()
  const { appInstallations } = useExtensionsContext()
  const fetchedRef = useRef(new Set<string>())
  const appInstallationsRef = useRef(appInstallations)
  appInstallationsRef.current = appInstallations

  const checkAndFetch = useCallback(() => {
    const state = useVarStore.getState()
    if (state.graph.nodes.length === 0) return

    // Find app nodes (type contains ':') with no output variables
    const appNodesWithoutOutputs = state.graph.nodes.filter((n: NodeMeta) => {
      const nodeType = n.data?.type || n.type || ''
      if (!nodeType.includes(':')) return false
      if (fetchedRef.current.has(n.id)) return false

      const output = state.nodeOutputs.get(n.id)
      return !output || (output.variables.length === 0 && !n.data?._computedOutputs)
    })

    if (appNodesWithoutOutputs.length === 0) return

    for (const node of appNodesWithoutOutputs) {
      fetchedRef.current.add(node.id)

      const appId = node.data?.appId as string | undefined
      const blockId = node.data?.blockId as string | undefined
      const appSlug = node.data?.appSlug as string | undefined

      if (!appId || !blockId) continue

      const installations = appInstallationsRef.current
      const installation =
        installations.find((i) => i.app.id === appId) ||
        (appSlug ? installations.find((i) => i.app.slug === appSlug) : undefined)

      if (!installation) {
        fetchedRef.current.delete(node.id)
        continue
      }

      const messageClient = appStore.getMessageClient({
        appId: installation.app.id,
        appInstallationId: installation.installationId,
      })

      if (!messageClient) {
        fetchedRef.current.delete(node.id)
        continue
      }

      void (async () => {
        try {
          await messageClient.waitUntilReady()

          const result = await messageClient.sendRequest<{ outputs: Record<string, any> | null }>(
            'compute-workflow-node-outputs',
            { blockId, data: node.data }
          )

          if (!result?.outputs) return

          const { nodes, setNodes } = store.getState()
          const newNodes = produce(nodes, (draft) => {
            const target = draft.find((n) => n.id === node.id)
            if (target) {
              target.data = { ...target.data, _computedOutputs: result.outputs }
            }
          })
          setNodes(newNodes)
        } catch {
          fetchedRef.current.delete(node.id)
        }
      })()
    }
  }, [store, appStore])

  useEffect(() => {
    checkAndFetch()

    const unsub = useVarStore.subscribe(
      (state) => state.graph.nodes.length + state.nodeOutputs.size,
      () => checkAndFetch()
    )

    return unsub
  }, [checkAndFetch])

  // Retry when app iframes load late
  useEffect(() => {
    const unsub = appStore.events.messageClientChanged.addListener(() => {
      checkAndFetch()
    })
    return unsub
  }, [appStore, checkAndFetch])
}

// apps/web/src/components/workflow/hooks/use-registry.ts

import { useEffect, useMemo, useState } from 'react'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import type { NodeDefinition } from '../types/registry'

/**
 * Subscribe to registry changes and get a specific node definition
 * Automatically re-renders when registry updates (e.g., when app blocks are loaded)
 * @param nodeType - The node type to get definition for
 * @returns Node definition or undefined if not found
 */
export function useNodeDefinition(nodeType: string | undefined): NodeDefinition | undefined {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = unifiedNodeRegistry.subscribe(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return useMemo(
    () => (nodeType ? unifiedNodeRegistry.getDefinition(nodeType) : undefined),
    [nodeType]
  )
}

/**
 * Subscribe to registry changes and get all trigger definitions
 * Automatically re-renders when registry updates (e.g., when app triggers are loaded)
 * @returns Array of trigger node definitions
 */
export function useTriggerDefinitions(): NodeDefinition[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = unifiedNodeRegistry.subscribe(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return useMemo(() => unifiedNodeRegistry.getTriggerDefinitions(), [])
}

/**
 * Subscribe to registry changes and get all non-trigger definitions
 * Automatically re-renders when registry updates (e.g., when app blocks are loaded)
 * @returns Array of non-trigger node definitions
 */
export function useNonTriggerDefinitions(): NodeDefinition[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = unifiedNodeRegistry.subscribe(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return useMemo(() => unifiedNodeRegistry.getNonTriggerDefinitions(), [])
}

/**
 * Subscribe to registry changes and run a custom selector function
 * Use this for complex queries not covered by specific hooks
 * @param selector - Function that queries the registry
 * @returns Result of the selector function
 */
export function useRegistrySelector<T>(selector: (registry: typeof unifiedNodeRegistry) => T): T {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = unifiedNodeRegistry.subscribe(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return useMemo(() => selector(unifiedNodeRegistry), [selector])
}

/**
 * Just subscribe to registry changes and return version number
 * Use when you need to trigger re-render but handle querying yourself
 * @returns Version number that increments on each registry change
 */
export function useRegistryVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = unifiedNodeRegistry.subscribe(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return version
}

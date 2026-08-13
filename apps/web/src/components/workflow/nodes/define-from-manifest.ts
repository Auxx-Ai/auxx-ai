// apps/web/src/components/workflow/nodes/define-from-manifest.ts

import type { NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { ComponentType } from 'react'
import type { NodeDefinition, NodePanelProps, TraceRendererProps } from '../types'
import type { UnifiedOutputVariablesFunction } from '../types/output-variables'

/**
 * React parts a manifest is merged with. The manifest (lib) carries the data
 * half of a node definition; these stay in apps/web forever — the node-catalog
 * migration's hard invariant is that node.tsx / panel.tsx / trace-renderer.tsx
 * never change.
 */
export interface ManifestComponents<TData> {
  component?: ComponentType<any>
  panel?: ComponentType<NodePanelProps<TData>>
  traceRenderer?: ComponentType<TraceRendererProps>
  /**
   * Web-only output-resolver override. Since Phase 2 the manifest carries
   * `resolveOutputs` (same signature — `OutputVariableContext` is an alias of
   * the catalog's `OutputContext`), so most merge sites omit this. Pass it
   * only while a node's resolver cannot move to lib yet (crud/find until
   * their Phase 2 context lands).
   */
  outputVariables?: UnifiedOutputVariablesFunction<TData>
}

/**
 * Build today's `NodeDefinition` from a lib catalog manifest plus the React
 * parts, so every existing registry consumer (`getPanel`, `getNodeIcon`,
 * `availableNextNodesForType`, `validateNode`, `computeNodeOutputs`) keeps
 * working unchanged as node types migrate. A migrated `core/<type>/schema.ts`
 * shrinks to one `defineFromManifest` call plus back-compat re-exports.
 */
export function defineFromManifest<TData>(
  manifest: NodeManifest<TData>,
  parts: ManifestComponents<TData>
): NodeDefinition<TData> {
  return {
    id: manifest.id,
    category: manifest.category,
    displayName: manifest.displayName,
    description: manifest.description,
    icon: manifest.icon,
    getIcon: manifest.getIcon,
    color: manifest.color,
    defaultData: manifest.defaultData(),
    schema: manifest.configSchema,
    component: parts.component,
    panel: parts.panel,
    traceRenderer: parts.traceRenderer,
    validator: manifest.validate,
    triggerType: manifest.triggerType,
    extractVariables: manifest.extractVariables,
    // Web override first, then the manifest's resolver. A node type that
    // declares neither exposes nothing downstream — same contract as note.
    outputVariables: parts.outputVariables ?? manifest.resolveOutputs ?? (() => []),
    canConnect: manifest.connection.canConnect,
    canRunSingle: manifest.connection.canRunSingle,
    acceptsInputNodes: manifest.connection.acceptsInputNodes,
    availableNextNodes: manifest.connection.availableNextNodes,
    availablePrevNodes: manifest.connection.availablePrevNodes,
    maxIncomingConnections: manifest.connection.maxIncomingConnections,
    maxOutgoingConnections: manifest.connection.maxOutgoingConnections,
  }
}

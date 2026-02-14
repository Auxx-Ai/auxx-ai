// apps/web/src/lib/extensions/reconstruct-react-tree.tsx

import React from 'react'
import { componentRegistry, getComponent } from './component-registry'

/**
 * Sanitized instance from the reconciler.
 */
interface SanitizedInstance {
  instance_type: 'instance' | 'text'
  instance_id?: number
  tag?: string
  component?: string
  attributes?: Record<string, any>
  children?: SanitizedInstance[]
  text?: string
}

/**
 * Tree container with children.
 */
interface TreeContainer {
  children: SanitizedInstance[]
}

/**
 * Options for reconstruction.
 */
interface ReconstructOptions {
  /** Props to inject into components (e.g., hideDialog) */
  injectedProps?: Record<string, any>
  /** Function to call event handlers in iframe */
  onCallHandler?: (instanceId: number, handlerId: string) => Promise<void>
}

/**
 * Reconstruct React tree from sanitized instance tree.
 *
 * This function takes the sanitized tree from the runtime reconciler
 * and converts it back into actual React elements that can be rendered
 * in the platform.
 *
 * @param tree - Sanitized tree from runtime (with children array)
 * @param options - Options including injected props
 * @returns React element
 */
export function reconstructReactTree(
  tree: TreeContainer,
  options?: ReconstructOptions
): React.ReactElement {
  const { injectedProps = {}, onCallHandler } = options || {}

  // Validate tree structure
  if (!tree) {
    console.error('[ReconstructReactTree] Tree is null or undefined')
    return React.createElement(React.Fragment, null, 'Error: No tree provided')
  }

  if (!tree.children) {
    console.error('[ReconstructReactTree] Tree has no children property')
    return React.createElement(React.Fragment, null, 'Error: Invalid tree structure')
  }

  if (!Array.isArray(tree.children)) {
    console.error('[ReconstructReactTree] Tree.children is not an array:', typeof tree.children)
    return React.createElement(React.Fragment, null, 'Error: children is not an array')
  }

  function reconstructNode(
    node: SanitizedInstance,
    key: string,
    isRoot: boolean = false
  ): React.ReactNode {
    if (!node) {
      return null
    }

    // Handle text instances
    if (node.instance_type === 'text') {
      return node.text
    }

    // Handle component instances
    if (node.instance_type === 'instance') {
      const { tag, attributes, component, children, instance_id } = node

      // Get the component from registry
      const Component = component ? getComponent(component) : null

      if (!Component) {
        console.error(`[ReconstructReactTree] Unknown component: "${component}"`)
        console.error(
          '[ReconstructReactTree] Available components:',
          Object.keys(componentRegistry)
        )
        throw new Error(`Extension attempted to use unauthorized component: "${component}"`)
      }

      // Build props, injecting special props at root level
      const props: any = isRoot ? { key, ...attributes, ...injectedProps } : { key, ...attributes }

      // Pass onCallHandler and instance_id to all components (for event handling)
      if (onCallHandler && instance_id !== undefined) {
        props.__instanceId = instance_id
        props.__onCallHandler = onCallHandler
      }

      // Special handling for Form component - needs raw children, not reconstructed
      if (component === 'Form') {
        props.children = children
        return React.createElement(Component, props)
      }

      // Reconstruct children recursively for all other components
      const reconstructedChildren = children?.map((child, i) =>
        reconstructNode(child, `${key}_${i}`, false)
      )

      return React.createElement(Component, props, ...(reconstructedChildren || []))
    }

    console.error('[ReconstructReactTree] Unknown instance type:', node)
    return null
  }

  // Reconstruct all root children with injected props
  const rootChildren = tree.children.map((child, i) => reconstructNode(child, `root_${i}`, true))

  // Return wrapped in fragment
  return React.createElement(React.Fragment, null, ...rootChildren)
}

// === Component Implementations ===

/**
 * Container for extension widgets.
 * This component wraps each widget instance and provides the hostInstanceId
 * for tracking and lifecycle management.
 */
function WidgetContainer({
  hostInstanceId,
  children,
}: {
  hostInstanceId: string
  children?: React.ReactNode
}) {
  return (
    <div data-widget-container data-host-instance-id={hostInstanceId} className='extension-widget'>
      {children}
    </div>
  )
}

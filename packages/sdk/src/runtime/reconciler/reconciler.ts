// packages/sdk/src/runtime/reconciler/reconciler.ts

/**
 * # React Reconciler Instance Creation and Rendering
 *
 * This file provides the main `render()` function that creates a React reconciler
 * instance and renders React elements into a virtual tree structure.
 *
 * ## Purpose
 *
 * The render() function:
 * 1. Creates a reconciler instance with custom host config
 * 2. Creates a container to hold the virtual tree
 * 3. Renders React element into the container
 * 4. Waits for commit phase to complete
 * 5. Sanitizes the tree and invokes onCommit callback
 *
 * ## Usage
 *
 * This is the main entry point for rendering extension components, workflow nodes,
 * dialogs, and other UI elements in the sandboxed iframe environment.
 *
 * @see packages/sdk/src/runtime/index.ts - Uses render() for app and component rendering
 * @see packages/sdk/src/runtime/workflow.ts - Uses render() for workflow node rendering
 * @see packages/sdk/src/runtime/reconciler/host-config.ts - Host config implementation
 * @see packages/sdk/src/runtime/reconciler/sanitizer.ts - Tree sanitization
 */

import ReactReconciler from 'react-reconciler'
import { makeHostConfig, type Container } from './host-config.js'
import { sanitize } from './sanitizer.js'
import type { RenderOptions } from './types.js'

/**
 * Create a React reconciler instance with custom host configuration.
 *
 * **Purpose**: Initialize the reconciler with host config that defines how React
 * operations (create, update, remove) map to our virtual tree structure.
 *
 * **Singleton vs Instance**: Each call creates a new reconciler instance. This allows
 * multiple independent render trees (e.g., main app + dialog + workflow node panel).
 *
 * @param options - Configuration options
 * @param options.onCallInstanceMethod - Callback for parent app to invoke instance methods
 * @returns Reconciler instance
 *
 * @example
 * ```typescript
 * const reconciler = makeReconciler({
 *   onCallInstanceMethod: async (instanceId, method, args) => {
 *     return eventBus.callTagEventListener(method, instanceId, args)
 *   }
 * })
 *
 * const container = reconciler.createContainer(containerInfo, ...)
 * reconciler.updateContainer(<App />, container, null, callback)
 * ```
 *
 * @see ReactReconciler - React's platform-agnostic rendering engine
 * @see makeHostConfig - Creates host configuration object
 */
function makeReconciler({
  onCallInstanceMethod,
}: {
  onCallInstanceMethod: (instanceId: number, method: string, args: any[]) => Promise<any>
}) {
  const config = makeHostConfig({ onCallInstanceMethod })
  return ReactReconciler(config)
}

/**
 * Error logging callback for reconciler.
 *
 * Used by React to report errors during rendering, commit, and error boundary handling.
 * Logs errors to console for debugging.
 *
 * @param error - The error that occurred
 */
function logError(error: Error) {
  console.error(error)
}

/**
 * No-op logging callback for reconciler.
 *
 * Used for React 19+ transition indicators which we don't implement.
 */
function logNoop() {}

/**
 * Render a React element into a virtual tree and invoke callback with sanitized output.
 *
 * This is the **main entry point** for rendering in the extension runtime. It creates
 * a reconciler instance, renders the element, and returns the sanitized tree via callback.
 *
 * ## Process Flow
 *
 * 1. **Container Creation**: Create Container with onCommit callback
 * 2. **Reconciler Setup**: Create reconciler instance with host config
 * 3. **React Rendering**: Call reconciler.updateContainer() to start render
 * 4. **Render Phase**: React calls createInstance, appendInitialChild, etc.
 * 5. **Commit Phase**: React calls commitMount, commitUpdate, etc.
 * 6. **After Commit**: React calls resetAfterCommit → container.onCommit()
 * 7. **Sanitization**: Container's onCommit sanitizes tree
 * 8. **User Callback**: onCommit callback invoked with SanitizedInstance[]
 * 9. **Resolution**: Promise resolves after initial render completes
 *
 * ## Lifecycle Sequence
 *
 * ```
 * render() called
 *   ↓
 * Create Container { children: [], onCommit: ... }
 *   ↓
 * Create Reconciler with host config
 *   ↓
 * reconciler.createContainer(containerInfo)
 *   ↓
 * reconciler.updateContainer(element, container)
 *   ↓
 * [RENDER PHASE - interruptible]
 *   - createInstance() for each custom element
 *   - createTextInstance() for text nodes
 *   - appendInitialChild() to build tree
 *   ↓
 * [COMMIT PHASE - synchronous]
 *   - commitMount() for new instances (tag.onMount())
 *   - commitUpdate() for updated instances
 *   - appendChild/removeChild for tree changes
 *   ↓
 * resetAfterCommit(container)
 *   ↓
 * container.onCommit() called
 *   ↓
 * sanitize(container.children)
 *   ↓
 * onCommit(sanitizedTree) invoked
 *   ↓
 * Promise resolves
 * ```
 *
 * ## Multiple Renders
 *
 * Each render() call creates an independent reconciler instance with its own container.
 * This allows multiple concurrent renders:
 * - Main app render
 * - Dialog render
 * - Workflow node render
 * - Panel render
 *
 * Each has isolated state and lifecycle.
 *
 * ## Updates After Initial Render
 *
 * After the initial render, React's reconciler continues to manage the tree:
 * - State changes trigger re-renders
 * - commitUpdate() called when props change
 * - resetAfterCommit() called after every commit
 * - onCommit callback invoked with updated tree each time
 *
 * @param options - Render configuration
 * @param options.element - React element to render (e.g., <App />)
 * @param options.onCommit - Callback invoked with sanitized tree after each commit
 * @param options.onCallInstanceMethod - Optional callback for parent to invoke instance methods
 * @returns Promise that resolves after initial render completes
 *
 * @example
 * ```typescript
 * // Render extension app
 * await render({
 *   element: <MyExtensionApp />,
 *   onCommit: (sanitizedTree) => {
 *     // Send to parent app
 *     Host.sendMessage('render', { root: { children: sanitizedTree } })
 *   },
 *   onCallInstanceMethod: async (instanceId, method, args) => {
 *     // Handle event invocations from parent
 *     return eventBus.callTagEventListener(method, instanceId, args)
 *   }
 * })
 *
 * // Promise resolves, initial render complete
 * // onCommit continues to be called on every update
 * ```
 *
 * @example
 * ```typescript
 * // Render workflow node
 * await render({
 *   element: <WorkflowNodeComponent data={nodeData} />,
 *   onCommit: (sanitizedTree) => {
 *     Host.sendResponse(requestId, { tree: sanitizedTree })
 *   }
 * })
 * ```
 *
 * @see Container - Root container holding the virtual tree
 * @see makeReconciler - Creates reconciler instance
 * @see sanitize - Converts ComponentInstance tree to SanitizedInstance tree
 * @see packages/sdk/src/runtime/index.ts - Main runtime that calls render()
 */
export async function render({
  element,
  onCommit,
  onCallInstanceMethod,
}: RenderOptions): Promise<void> {
  // Create container with onCommit callback that sanitizes tree
  const containerInfo: Container = {
    children: [],
    onCommit: () => {
      // Sanitize the tree before calling user callback
      // Converts ComponentInstance[] → SanitizedInstance[]
      const sanitized = sanitize(containerInfo.children)
      onCommit(sanitized)
    },
  }

  // Create reconciler instance with host config
  const reconciler = makeReconciler({
    onCallInstanceMethod: onCallInstanceMethod || (async () => undefined),
  })

  // Create reconciler container
  // This is React's internal container structure, separate from our Container
  const container = reconciler.createContainer(
    containerInfo, // Root container info (our Container type)
    0, // tag (legacy, unused)
    null, // hydrationCallbacks (for SSR, not used)
    false, // isStrictMode (strict mode disabled)
    null, // concurrentUpdatesByDefaultOverride (use default)
    '', // identifierPrefix (for IDs, empty)
    logError, // onUncaughtError (error boundary errors)
    logError, // onCaughtError (caught errors)
    logError, // onRecoverableError (recoverable errors)
    logNoop, // onDefaultTransitionIndicator (React 19+, not used)
    null // transitionCallbacks (React 19+, not used)
  )

  // Render element and return promise that resolves after initial render
  return new Promise((resolve) => {
    reconciler.updateContainer(
      element, // React element to render
      container, // Reconciler container
      null, // Parent component (null for root)
      resolve // Callback invoked after initial render completes
    )
  })
}

/**
 * Re-export types for convenience.
 *
 * Allows consumers to import types from this file instead of navigating to types.ts.
 */
export type { SanitizedInstance, ReconcilerConfig, RenderOptions } from './types.js'

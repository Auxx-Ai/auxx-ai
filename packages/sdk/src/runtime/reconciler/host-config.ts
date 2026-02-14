// packages/sdk/src/runtime/reconciler/host-config.ts

/**
 * # React Reconciler Host Configuration for Extension Runtime
 *
 * This file implements a **custom React Reconciler** that enables React components to render
 * into a **virtual, serializable tree structure** instead of the DOM. This is the foundation
 * of Auxx.ai's sandboxed iframe-based extension system.
 *
 * ## Architecture Overview
 *
 * ```
 * Extension Code (React JSX in iframe)
 *          ↓
 * React Reconciler (this file)
 *          ↓
 * Virtual Tree (ComponentInstance + TextInstance)
 *          ↓
 * Sanitizer (removes functions, classes)
 *          ↓
 * postMessage to Parent App
 *          ↓
 * Parent Reconstructs UI
 * ```
 *
 * ## Purpose
 *
 * The reconciler intercepts React's rendering operations to:
 * 1. **Create virtual instances** - Build ComponentInstance/TextInstance tree instead of DOM nodes
 * 2. **Manage lifecycle** - Call onCreate/onMount/onUpdate/onDestroy on Tag instances
 * 3. **Handle events** - Register event handlers in global registry for cross-iframe communication
 * 4. **Enable serialization** - Maintain structure that can be sanitized and sent via postMessage
 * 5. **Provide isolation** - Extensions cannot access parent DOM or sensitive data
 *
 * ## Security Model
 *
 * - Extensions run in sandboxed iframes with no direct DOM access
 * - All UI is serialized and reconstructed by parent app
 * - Event handlers stored in iframe; parent sends invocation requests
 * - Functions and class instances cannot cross iframe boundary
 *
 * ## Key Concepts
 *
 * **Tag System**: Each custom element (e.g., `<auxxbutton>`) creates a Tag instance (ButtonTag)
 * that handles serialization, event registration, and lifecycle.
 *
 * **Instance Registry**: Maps instance IDs to Tag instances for event handler lookup when
 * parent app forwards user interactions back to iframe.
 *
 * **Virtual Tree**: ComponentInstance and TextInstance form a tree that mirrors React's
 * component tree but is fully serializable after sanitization.
 *
 * **Lifecycle Flow**:
 * 1. React renders `<auxxbutton onClick={handler} />`
 * 2. createInstance() called → creates ButtonTag → returns ComponentInstance
 * 3. commitMount() called → tag.onMount() → registers event handlers
 * 4. resetAfterCommit() called → container.onCommit() → sanitizes and sends tree
 * 5. User clicks button in parent → parent sends instanceId + event name
 * 6. Runtime looks up tag → calls handler → returns result
 *
 * ## React Reconciler Pattern
 *
 * This implements the same pattern used by:
 * - React Native (renders to native components)
 * - React Three Fiber (renders to Three.js)
 * - React PDF (renders to PDF documents)
 * - Ink (renders to terminal)
 *
 * React's reconciler provides ~40 lifecycle hooks that this file implements to control
 * how React's virtual DOM operations map to our virtual tree structure.
 *
 * @see https://github.com/facebook/react/tree/main/packages/react-reconciler
 * @see packages/sdk/src/runtime/reconciler/tags/base-tag.ts - Tag base class
 * @see packages/sdk/src/runtime/reconciler/sanitizer.ts - Tree sanitization
 * @see packages/sdk/src/runtime/index.ts - Runtime that uses this reconciler
 */

import React from 'react'
import { generateInstanceId } from './instance-id.js'
import type { BaseTag } from './tags/base-tag.js'
import { createTag, isCustomElement } from './tags/index.js'

/**
 * Global registry of Tag instances for event handler invocation.
 *
 * **Purpose**: Enable parent app to invoke event handlers by instance ID.
 *
 * **Lifecycle**:
 * 1. Tag created in createInstance() → registered via registerTagInstance()
 * 2. Parent sends event invocation request with instanceId
 * 3. Runtime calls getTagInstance(instanceId) to lookup handler
 * 4. Instance destroyed → unregisterTagInstance() called to prevent memory leaks
 *
 * **Example Flow**:
 * ```typescript
 * // Extension renders button
 * <auxxbutton onClick={() => console.log('clicked')} />
 *
 * // Creates ButtonTag with instanceId=123, registers in map
 * tagInstanceRegistry.set(123, buttonTagInstance)
 *
 * // User clicks button in parent app
 * // Parent sends: { instanceId: 123, eventName: 'onClick' }
 *
 * // Runtime retrieves tag
 * const tag = getTagInstance(123)
 * // Calls handler via EventBus
 * ```
 *
 * @see registerTagInstance - Adds tag to registry
 * @see unregisterTagInstance - Removes tag from registry
 * @see getTagInstance - Retrieves tag for event invocation
 */
const tagInstanceRegistry = new Map<number, BaseTag>()

/**
 * Register a Tag instance in the global registry.
 *
 * **When Called**: In createInstance() after tag.onCreate()
 *
 * **Purpose**: Make tag available for event handler invocation when parent app
 * forwards user interactions (clicks, inputs, etc.) back to iframe.
 *
 * @param tag - The Tag instance to register (ButtonTag, FormTag, etc.)
 *
 * @example
 * ```typescript
 * const tag = new ButtonTag(props)
 * tag.onCreate()
 * registerTagInstance(tag) // Now parent can call events on this tag
 * ```
 */
function registerTagInstance(tag: BaseTag): void {
  tagInstanceRegistry.set(tag.instanceId, tag)
}

/**
 * Unregister a Tag instance from the global registry.
 *
 * **When Called**: In removeInstanceRecursive() when instance is removed from tree
 *
 * **Purpose**: Prevent memory leaks and ensure removed instances cannot receive
 * event invocations.
 *
 * **Critical**: Must be called for every registered tag to prevent memory leaks.
 *
 * @param instanceId - The unique ID of the instance to unregister
 *
 * @example
 * ```typescript
 * // Component unmounts
 * removeInstanceRecursive(instance)
 * // → calls tag.onDestroy()
 * // → calls unregisterTagInstance(instance.instance_id)
 * ```
 */
function unregisterTagInstance(instanceId: number): void {
  tagInstanceRegistry.delete(instanceId)
}

/**
 * Retrieve a Tag instance by ID for event handler invocation.
 *
 * **When Called**: By runtime when parent app forwards user interaction
 *
 * **Purpose**: Enable cross-iframe event handling by looking up the tag that
 * contains the event handler function.
 *
 * @param instanceId - The unique ID of the instance
 * @returns The Tag instance if found, undefined if not registered or already destroyed
 *
 * @example
 * ```typescript
 * // Parent app sends: { type: 'call-instance-method', instanceId: 123, eventName: 'onClick' }
 *
 * // Runtime handles:
 * const tag = getTagInstance(123)
 * if (tag) {
 *   // EventBus calls the registered onClick handler
 *   await eventBus.callTagEventListener('onClick', 123, [])
 * }
 * ```
 *
 * @see packages/sdk/src/runtime/index.ts - Runtime event handling
 * @see packages/sdk/src/runtime/event-bus.ts - EventBus that invokes handlers
 */
export function getTagInstance(instanceId: number): BaseTag | undefined {
  return tagInstanceRegistry.get(instanceId)
}

/**
 * Instance types in the reconciler virtual tree.
 *
 * - `'instance'`: Custom component (e.g., auxxbutton, auxxform)
 * - `'text'`: Text node (plain string content)
 */
export type InstanceType = 'instance' | 'text'

/**
 * Base interface for all instances in the reconciler tree.
 *
 * All instances (ComponentInstance and TextInstance) share these common properties
 * for tree management and visibility control.
 *
 * @property instance_type - Discriminator for type narrowing ('instance' | 'text')
 * @property instance_id - Unique identifier for cross-iframe reference
 * @property hidden - Visibility flag controlled by React Suspense/hide APIs
 */
export interface BaseInstance {
  /** Discriminates between ComponentInstance and TextInstance */
  instance_type: InstanceType
  /** Unique ID generated via generateInstanceId(), used for event handler lookup */
  instance_id: number
  /** Visibility flag (set via hideInstance/unhideInstance, used by Suspense) */
  hidden: boolean
}

/**
 * Represents a custom component instance in the reconciler tree.
 *
 * Created when React renders a custom element like `<auxxbutton>` or `<auxxform>`.
 * Contains the Tag instance that handles serialization and event management.
 *
 * **Lifecycle**:
 * 1. Created in createInstance() with associated Tag
 * 2. Children appended via appendChild/appendInitialChild
 * 3. Mounted via commitMount() → tag.onMount() called
 * 4. Updated via commitUpdate() → tag.propsChanged event triggered
 * 5. Removed via removeChild → tag.onDestroy() called
 *
 * **Serialization**: Converted to SanitizedInstance via sanitizer.ts for postMessage
 *
 * @property instance_type - Always 'instance' (discriminator)
 * @property tag - The Tag instance (ButtonTag, FormTag, etc.) that handles this component
 * @property component - Component name for identification (e.g., 'Button', 'Form')
 * @property props - Current props passed to component
 * @property children - Child instances (ComponentInstance or TextInstance)
 *
 * @example
 * ```typescript
 * // React renders: <auxxbutton label="Click me" onClick={handler} />
 *
 * // Creates:
 * const instance: ComponentInstance = {
 *   instance_type: 'instance',
 *   instance_id: 123,
 *   tag: buttonTagInstance,
 *   component: 'Button',
 *   props: { label: 'Click me', onClick: [Function] },
 *   hidden: false,
 *   children: []
 * }
 * ```
 *
 * @see BaseTag - Tag base class with lifecycle hooks
 * @see sanitizer.ts - Converts to SanitizedInstance for cross-iframe transport
 */
export interface ComponentInstance extends BaseInstance {
  instance_type: 'instance'
  /** Tag instance that manages serialization and event handling */
  tag: BaseTag
  /** Component name for identification (e.g., 'Button', 'Form', 'WorkflowNode') */
  component: string
  /** Current props (includes event handlers, data, etc.) */
  props: Record<string, any>
  /** Child instances in the tree */
  children?: (ComponentInstance | TextInstance)[]
}

/**
 * Represents a text node in the reconciler tree.
 *
 * Created when React renders plain text content. These are leaf nodes
 * in the tree with no children.
 *
 * **Lifecycle**:
 * 1. Created in createTextInstance() with initial text
 * 2. Updated via commitTextUpdate() when text changes
 * 3. Removed via removeChild when unmounted
 *
 * **Serialization**: Converted to SanitizedInstance with text property
 *
 * @property instance_type - Always 'text' (discriminator)
 * @property text - The text content
 *
 * @example
 * ```typescript
 * // React renders: <div>Hello World</div>
 *
 * // Creates text instance:
 * const textInstance: TextInstance = {
 *   instance_type: 'text',
 *   instance_id: 124,
 *   text: 'Hello World',
 *   hidden: false
 * }
 * ```
 */
export interface TextInstance extends BaseInstance {
  instance_type: 'text'
  /** The text content */
  text: string
}

/**
 * Root container that holds the top-level instances of the reconciler tree.
 *
 * Created by reconciler.ts when render() is called. The container's onCommit
 * callback is invoked after React finishes committing changes, triggering
 * sanitization and postMessage to parent app.
 *
 * **Lifecycle**:
 * 1. Created with empty children array and onCommit callback
 * 2. React appends root instances via appendChildToContainer
 * 3. After commit phase, resetAfterCommit() calls container.onCommit()
 * 4. onCommit triggers sanitization and sends tree to parent
 *
 * @property children - Top-level instances in the tree
 * @property onCommit - Callback invoked after React commits changes
 *
 * @example
 * ```typescript
 * const container: Container = {
 *   children: [],
 *   onCommit: () => {
 *     // Sanitize tree and send to parent
 *     const sanitized = sanitizeInstance(container.children)
 *     Host.sendMessage('render', { root: { children: sanitized } })
 *   }
 * }
 * ```
 *
 * @see packages/sdk/src/runtime/reconciler/reconciler.ts - Creates container
 * @see packages/sdk/src/runtime/reconciler/sanitizer.ts - Sanitizes tree in onCommit
 */
export interface Container {
  /** Root-level instances (no parent) */
  children: (ComponentInstance | TextInstance)[]
  /** Called after React commits changes; triggers sanitization and postMessage */
  onCommit: () => void
}

/**
 * Configuration options for the host config.
 *
 * Passed to makeHostConfig() to provide callbacks for cross-iframe communication.
 *
 * @property onCallInstanceMethod - Callback to invoke instance methods from parent app
 *
 * @example
 * ```typescript
 * const hostConfig = makeHostConfig({
 *   onCallInstanceMethod: async (instanceId, method, args) => {
 *     const tag = getTagInstance(instanceId)
 *     return eventBus.callTagEventListener(method, instanceId, args)
 *   }
 * })
 * ```
 */
export interface HostConfigOptions {
  /** Callback to handle instance method calls from parent app */
  onCallInstanceMethod: (instanceId: number, method: string, args: any[]) => Promise<any>
}

/** No-op function for React reconciler methods that don't need implementation */
const noOp = () => {}

/**
 * Helper to create a function that always returns a constant value.
 * Used for React reconciler methods that need to return fixed values.
 */
const always =
  <T>(value: T) =>
  () =>
    value

/**
 * Default event priority constant for React scheduling.
 *
 * React 18+ uses priority-based scheduling. This default priority (16) represents
 * "normal" priority events (user interactions, updates, etc.).
 *
 * **Priority Levels**:
 * - DiscreteEventPriority (2): Click, keypress, etc.
 * - ContinuousEventPriority (8): Drag, scroll, etc.
 * - DefaultEventPriority (16): Default for most updates (used here)
 * - IdleEventPriority (536870912): Low-priority background work
 *
 * Since our reconciler doesn't implement priority scheduling (all updates processed
 * immediately), this is a safe default that works for all use cases.
 */
const DefaultEventPriority = 16

/**
 * Recursively cleanup instance and all descendants.
 *
 * **When Called**: When instance is removed from tree via removeChild/removeChildFromContainer
 *
 * **Purpose**:
 * 1. Call tag.onDestroy() lifecycle hook (cleanup, unregister handlers)
 * 2. Unregister from tagInstanceRegistry to prevent memory leaks
 * 3. Recursively cleanup all child instances
 *
 * **Critical for Memory Management**: Must be called for every removed instance
 * to ensure event handlers are cleaned up and tag registry doesn't accumulate stale entries.
 *
 * @param instance - The instance to remove (ComponentInstance or TextInstance)
 *
 * @example
 * ```typescript
 * // Component unmounts
 * removeChild(parentInstance, childInstance)
 * // → calls removeInstanceRecursive(childInstance)
 * //   → childInstance.tag.onDestroy() called
 * //   → unregisterTagInstance(childInstance.instance_id)
 * //   → recursively processes all children
 * ```
 *
 * @see removeChild - Reconciler method that calls this
 * @see removeChildFromContainer - Reconciler method that calls this
 * @see BaseTag.onDestroy - Lifecycle hook called for cleanup
 */
function removeInstanceRecursive(instance: ComponentInstance | TextInstance): void {
  if (instance.instance_type === 'instance') {
    // Call lifecycle hook for cleanup (unregister event handlers, etc.)
    instance.tag.onDestroy()

    // Unregister from global registry to prevent memory leaks
    unregisterTagInstance(instance.instance_id)

    // Recursively cleanup all children
    if (instance.children) {
      instance.children.forEach(removeInstanceRecursive)
    }
  }
  // TextInstance has no cleanup needed (no tag, no children)
}

/**
 * Create React Reconciler host configuration.
 *
 * This is the main entry point that creates the configuration object passed to
 * React's `ReactReconciler()` function. The host config implements ~40 lifecycle
 * methods that React calls during rendering, updates, and unmounting.
 *
 * ## What is a Host Config?
 *
 * React's reconciler is platform-agnostic. The host config tells React how to
 * interact with the specific rendering target (DOM, Native, PDF, or in our case,
 * a virtual tree). Each method handles a specific operation like creating elements,
 * appending children, updating props, etc.
 *
 * ## Reconciler Phases
 *
 * **Render Phase** (interruptible, can be paused):
 * - createInstance, createTextInstance - Create elements
 * - appendInitialChild - Build initial tree
 *
 * **Commit Phase** (synchronous, cannot be interrupted):
 * - commitMount - Called after initial mount
 * - commitUpdate - Called when props change
 * - appendChild, insertBefore, removeChild - Tree manipulation
 * - resetAfterCommit - Called after all commits (triggers our serialization)
 *
 * ## Key Methods Implemented
 *
 * **Instance Creation**:
 * - `createInstance()` - Create ComponentInstance with Tag
 * - `createTextInstance()` - Create TextInstance
 *
 * **Tree Building**:
 * - `appendChild()` - Add child to parent
 * - `appendInitialChild()` - Add child during initial render
 * - `insertBefore()` - Insert child at specific position
 * - `removeChild()` - Remove child and cleanup
 *
 * **Lifecycle**:
 * - `commitMount()` - Call tag.onMount() after first render
 * - `commitUpdate()` - Trigger tag.propsChanged when props change
 * - `resetAfterCommit()` - Call container.onCommit() to serialize tree
 *
 * **Visibility Control** (used by Suspense):
 * - `hideInstance()` / `unhideInstance()` - Control instance visibility
 *
 * ## React 19 Compatibility
 *
 * Includes numerous React 19-specific stubs (transitions, suspense, scheduling)
 * with minimal implementations since we don't need those features for virtual tree rendering.
 *
 * @param options - Configuration options
 * @param options.onCallInstanceMethod - Callback for parent app to invoke instance methods
 * @returns Host config object passed to ReactReconciler()
 *
 * @example
 * ```typescript
 * import ReactReconciler from 'react-reconciler'
 *
 * const hostConfig = makeHostConfig({
 *   onCallInstanceMethod: async (instanceId, method, args) => {
 *     return eventBus.callTagEventListener(method, instanceId, args)
 *   }
 * })
 *
 * const reconciler = ReactReconciler(hostConfig)
 * ```
 *
 * @see https://github.com/facebook/react/tree/main/packages/react-reconciler
 * @see packages/sdk/src/runtime/reconciler/reconciler.ts - Creates reconciler with this config
 */
/**
 * Shallow comparison of props objects
 */
function propsEqual(prev: Record<string, any>, next: Record<string, any>): boolean {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)

  if (prevKeys.length !== nextKeys.length) return false

  for (const key of prevKeys) {
    if (prev[key] !== next[key]) return false
  }

  return true
}

export const makeHostConfig = ({ onCallInstanceMethod }: HostConfigOptions): any => ({
  // ==========================================
  // Core Reconciler Configuration
  // ==========================================

  /** Enable mutation mode (appendChild, removeChild, etc.) */
  supportsMutation: true,
  /** Disable persistence mode (immutable tree updates) */
  supportsPersistence: false,
  /** Sentinel value for "no timeout" */
  noTimeout: -1,
  /** Use browser's setTimeout for async scheduling */
  scheduleTimeout: setTimeout,
  /** Use browser's clearTimeout for canceling timeouts */
  cancelTimeout: clearTimeout,
  /** This is the primary renderer (not a secondary renderer like React DevTools) */
  isPrimaryRenderer: true,
  /** Disable server-side hydration */
  supportsHydration: false,
  /** Disable microtask scheduling */
  supportsMicrotasks: false,

  // ==========================================
  // React 19+ Priority & Scheduling
  // ==========================================

  /** Return current update priority (always default since we don't implement priority scheduling) */
  getCurrentUpdatePriority: always(DefaultEventPriority),
  /** Set update priority (no-op, we don't implement priority scheduling) */
  setCurrentUpdatePriority: noOp,
  /** Resolve update priority to concrete value */
  resolveUpdatePriority: () => DefaultEventPriority,

  // ==========================================
  // Public Instance API
  // ==========================================

  /**
   * Get public instance API for a component instance.
   *
   * Called by React when refs are accessed. Returns an object with methods
   * that can be called from parent app via cross-iframe communication.
   *
   * @param instance - The ComponentInstance
   * @returns Public API with callMethod function
   */
  getPublicInstance: (instance: ComponentInstance) => ({
    callMethod: async (method: string, args: any[]) =>
      onCallInstanceMethod(instance.instance_id, method, args),
  }),

  // ==========================================
  // Context Management
  // ==========================================

  /** Get root host context (we don't use context, return dummy value) */
  getRootHostContext: always(true),
  /** Get child host context (we don't use context, return dummy value) */
  getChildHostContext: always(true),

  // ==========================================
  // Commit Lifecycle
  // ==========================================

  /**
   * Called after React finishes committing all changes.
   *
   * **Purpose**: Trigger sanitization and postMessage to parent app.
   *
   * **Lifecycle Position**: Last step in commit phase, after all DOM updates complete.
   *
   * @param container - The root container
   */
  resetAfterCommit: (container: Container) => {
    container.onCommit()
  },

  // ==========================================
  // Text Content Optimization
  // ==========================================

  /** Never set text content directly (always create TextInstance children) */
  shouldSetTextContent: always(false),

  // ==========================================
  // Instance Creation (Render Phase)
  // ==========================================

  /**
   * Create a custom component instance.
   *
   * **When Called**: During render phase when React encounters a custom element like `<auxxbutton>`
   *
   * **Purpose**:
   * 1. Validate element type is registered in TAG_REGISTRY
   * 2. Create corresponding Tag instance (ButtonTag, FormTag, etc.)
   * 3. Call tag.onCreate() lifecycle hook
   * 4. Register tag in global registry for event handler lookup
   * 5. Return ComponentInstance for React to manage
   *
   * **Lifecycle**:
   * - Render Phase: createInstance called
   * - Render Phase: appendInitialChild called to add children
   * - Commit Phase: commitMount called (tag.onMount())
   * - Commit Phase: resetAfterCommit called (sanitize and send to parent)
   *
   * @param type - Element type (e.g., 'auxxbutton', 'auxxform')
   * @param props - Props passed to element (including event handlers)
   * @returns ComponentInstance wrapping the Tag
   * @throws Error if type is not registered in TAG_REGISTRY
   *
   * @example
   * ```typescript
   * // React renders:
   * <auxxbutton label="Click me" onClick={handler} />
   *
   * // createInstance called with:
   * // type = 'auxxbutton'
   * // props = { label: 'Click me', onClick: [Function] }
   *
   * // Returns ComponentInstance with ButtonTag
   * ```
   */
  createInstance: (type: string, props: Record<string, any>): ComponentInstance => {
    // Validate element type is registered
    if (!isCustomElement(type)) {
      throw new Error(`Unknown tag: ${type}`)
    }

    // Create Tag instance (ButtonTag, FormTag, etc.)
    const tag = createTag(type, props)

    // Call onCreate lifecycle hook
    tag.onCreate()

    // Register in global registry for event handler invocation
    registerTagInstance(tag)

    // Create ComponentInstance wrapper
    const instance: ComponentInstance = {
      instance_type: 'instance',
      tag,
      component: props.component || type,
      instance_id: tag.instanceId,
      props,
      hidden: false,
    }

    return instance
  },

  /**
   * Create a text node instance.
   *
   * **When Called**: During render phase when React encounters plain text content
   *
   * **Purpose**: Create TextInstance for text nodes in the virtual tree
   *
   * @param text - The text content
   * @returns TextInstance with unique ID
   *
   * @example
   * ```typescript
   * // React renders:
   * <div>Hello World</div>
   *
   * // createTextInstance called with:
   * // text = 'Hello World'
   *
   * // Returns:
   * // { instance_type: 'text', instance_id: 124, text: 'Hello World', hidden: false }
   * ```
   */
  createTextInstance: (text: string): TextInstance => ({
    instance_type: 'text',
    instance_id: generateInstanceId(),
    text,
    hidden: false,
  }),

  // ==========================================
  // Tree Building (Render Phase)
  // ==========================================

  /**
   * Append child to parent during initial render.
   *
   * **When Called**: During render phase after child instance is created
   *
   * **Purpose**: Build parent-child relationships in virtual tree
   *
   * @param parentInstance - The parent ComponentInstance
   * @param child - The child instance to append (ComponentInstance or TextInstance)
   */
  appendInitialChild: (
    parentInstance: ComponentInstance,
    child: ComponentInstance | TextInstance
  ) => {
    if (!parentInstance.children) {
      parentInstance.children = []
    }
    parentInstance.children.push(child)
  },

  /**
   * Finalize children after initial construction.
   *
   * **When Called**: After all appendInitialChild calls complete for an instance
   *
   * **Return Value**: Returning `true` causes commitMount to be called later
   *
   * @returns Always true to trigger commitMount lifecycle
   */
  finalizeInitialChildren: always(true),

  // ==========================================
  // Lifecycle Hooks (Commit Phase)
  // ==========================================

  /**
   * Called after instance is first mounted to the tree.
   *
   * **When Called**: Commit phase, after instance and all children are committed
   *
   * **Purpose**: Trigger tag.onMount() lifecycle hook for initialization
   * (e.g., register event handlers in EventBus)
   *
   * **Lifecycle**: This is where event handlers get registered via registerEventHandler()
   * listening to the tag's mounted event broker.
   *
   * @param instance - The ComponentInstance being mounted
   * @param _type - Element type (unused)
   * @param _props - Props (unused, already stored in instance)
   *
   * @example
   * ```typescript
   * // After <auxxbutton onClick={handler} /> is mounted:
   * commitMount(buttonInstance)
   * // → calls buttonInstance.tag.onMount({ instance_id: 123 })
   * // → triggers tag.mounted event broker
   * // → registerEventHandler receives event, registers onClick in EventBus
   * ```
   */
  commitMount: (instance: ComponentInstance, _type: string, _props: Record<string, any>) => {
    // Fire mounted lifecycle hook
    instance.tag.onMount({ instance_id: instance.instance_id })
  },

  // ==========================================
  // Tree Manipulation (Commit Phase - Updates)
  // ==========================================

  /**
   * Append child to parent after initial render.
   *
   * **When Called**: During updates when new children are added
   *
   * **Purpose**: Add child to parent's children array
   *
   * @param parentInstance - The parent ComponentInstance
   * @param child - The child instance to append
   */
  appendChild: (parentInstance: ComponentInstance, child: ComponentInstance | TextInstance) => {
    if (!parentInstance.children) {
      parentInstance.children = []
    }
    parentInstance.children.push(child)
  },

  /**
   * Append child to root container.
   *
   * **When Called**: When top-level instance is added to tree
   *
   * **Purpose**: Add instance to container's root children array
   *
   * @param container - The root Container
   * @param child - The child instance to append
   */
  appendChildToContainer: (container: Container, child: ComponentInstance | TextInstance) => {
    container.children.push(child)
  },

  /**
   * Insert child before another child in parent.
   *
   * **When Called**: When React reorders children or inserts at specific position
   *
   * **Purpose**: Insert child at specific position in parent's children array
   *
   * **Algorithm**:
   * 1. Find index of beforeChild
   * 2. If child already exists in array, remove it first
   * 3. Insert child at beforeChild's position
   *
   * @param parentInstance - The parent ComponentInstance
   * @param child - The child to insert
   * @param beforeChild - The child to insert before
   * @throws Error if beforeChild not found or parent has no children
   */
  insertBefore: (
    parentInstance: ComponentInstance,
    child: ComponentInstance | TextInstance,
    beforeChild: ComponentInstance | TextInstance
  ) => {
    if (!parentInstance.children) {
      throw new Error('Called insertBefore on an instance with no children')
    }
    let beforeIndex = parentInstance.children.indexOf(beforeChild)
    if (beforeIndex === -1) {
      throw new Error('Called insertBefore with an unknown beforeChild')
    }
    // Remove child if already in array (handle reordering)
    const childIndex = parentInstance.children.indexOf(child)
    if (childIndex !== -1) {
      parentInstance.children.splice(childIndex, 1)
      if (childIndex < beforeIndex) {
        beforeIndex -= 1
      }
    }
    parentInstance.children.splice(beforeIndex, 0, child)
  },

  /**
   * Insert child before another child in root container.
   *
   * **When Called**: When React reorders or inserts top-level children
   *
   * **Purpose**: Insert child at specific position in container's children array
   *
   * @param container - The root Container
   * @param child - The child to insert
   * @param beforeChild - The child to insert before
   * @throws Error if beforeChild not found
   */
  insertInContainerBefore: (
    container: Container,
    child: ComponentInstance | TextInstance,
    beforeChild: ComponentInstance | TextInstance
  ) => {
    let beforeIndex = container.children.indexOf(beforeChild)
    if (beforeIndex === -1) {
      throw new Error('Called insertInContainerBefore with an unknown beforeChild')
    }
    const childIndex = container.children.indexOf(child)
    if (childIndex !== -1) {
      container.children.splice(childIndex, 1)
      if (childIndex < beforeIndex) {
        beforeIndex -= 1
      }
    }
    container.children.splice(beforeIndex, 0, child)
  },

  /**
   * Remove child from parent and cleanup.
   *
   * **When Called**: When React unmounts a component
   *
   * **Purpose**:
   * 1. Remove child from parent's children array
   * 2. Call removeInstanceRecursive to cleanup tag and all descendants
   *
   * **Critical**: removeInstanceRecursive handles:
   * - Calling tag.onDestroy() lifecycle
   * - Unregistering from tagInstanceRegistry
   * - Recursively cleaning up all descendants
   *
   * @param parentInstance - The parent ComponentInstance
   * @param child - The child to remove
   * @throws Error if child not found or parent has no children
   *
   * @example
   * ```typescript
   * // Component unmounts
   * removeChild(parentInstance, childInstance)
   * // → removes from children array
   * // → calls removeInstanceRecursive(childInstance)
   * //   → childInstance.tag.onDestroy()
   * //   → unregisterTagInstance(childInstance.instance_id)
   * //   → recursively processes all children
   * ```
   */
  removeChild: (parentInstance: ComponentInstance, child: ComponentInstance | TextInstance) => {
    if (!parentInstance.children) {
      throw new Error('Called removeChild on an instance with no children')
    }
    const childIndex = parentInstance.children.indexOf(child)
    if (childIndex === -1) {
      throw new Error('Called removeChild with an unknown child')
    }
    parentInstance.children.splice(childIndex, 1)
    removeInstanceRecursive(child)
  },

  /**
   * Remove child from root container and cleanup.
   *
   * **When Called**: When top-level component unmounts
   *
   * **Purpose**: Same as removeChild but for root-level instances
   *
   * @param container - The root Container
   * @param child - The child to remove
   * @throws Error if child not found
   */
  removeChildFromContainer: (container: Container, child: ComponentInstance | TextInstance) => {
    const childIndex = container.children.indexOf(child)
    if (childIndex === -1) {
      throw new Error('Called removeChildFromContainer with an unknown child')
    }
    container.children.splice(childIndex, 1)
    removeInstanceRecursive(child)
  },

  /**
   * Update text content of text instance.
   *
   * **When Called**: When text content changes
   *
   * **Purpose**: Update text property of TextInstance
   *
   * @param textInstance - The TextInstance to update
   * @param _prevText - Previous text (unused)
   * @param nextText - New text content
   */
  commitTextUpdate: (textInstance: TextInstance, _prevText: string, nextText: string) => {
    textInstance.text = nextText
  },

  // ==========================================
  // Visibility Control (Suspense)
  // ==========================================

  /**
   * Hide a component instance.
   *
   * **When Called**: By React Suspense when component is suspended
   *
   * **Purpose**: Mark instance as hidden (filtered out during sanitization)
   *
   * @param instance - The ComponentInstance to hide
   */
  hideInstance: (instance: ComponentInstance) => {
    instance.hidden = true
  },

  /**
   * Hide a text instance.
   *
   * **When Called**: By React Suspense when text node is suspended
   *
   * **Purpose**: Mark text instance as hidden
   *
   * @param textInstance - The TextInstance to hide
   */
  hideTextInstance: (textInstance: TextInstance) => {
    textInstance.hidden = true
  },

  /**
   * Unhide a component instance.
   *
   * **When Called**: By React Suspense when component is no longer suspended
   *
   * **Purpose**: Mark instance as visible again
   *
   * @param instance - The ComponentInstance to unhide
   */
  unhideInstance: (instance: ComponentInstance) => {
    instance.hidden = false
  },

  /**
   * Unhide a text instance.
   *
   * **When Called**: By React Suspense when text node is no longer suspended
   *
   * **Purpose**: Mark text instance as visible again
   *
   * @param textInstance - The TextInstance to unhide
   */
  unhideTextInstance: (textInstance: TextInstance) => {
    textInstance.hidden = false
  },

  /**
   * Clear all children from container.
   *
   * **When Called**: When root is unmounted or cleared
   *
   * **Purpose**: Remove all root-level instances
   *
   * **Note**: This doesn't call cleanup; React handles unmounting children separately
   *
   * @param container - The root Container
   */
  clearContainer: (container: Container) => {
    container.children = []
  },

  // ==========================================
  // Props Updates (Commit Phase)
  // ==========================================

  /**
   * Commit prop updates to instance.
   *
   * **When Called**: During commit phase when props change
   *
   * **Purpose**:
   * 1. Update instance.props to new values
   * 2. Update instance.component name if changed
   * 3. Trigger tag.propsChanged event broker
   *
   * **Event Flow**:
   * - tag.propsChanged.trigger() fires
   * - registerEventHandler listeners receive event
   * - Event handlers update EventBus registrations as needed
   * - Tag's getAttributes() will be called during next sanitization
   *
   * @param instance - The ComponentInstance to update
   * @param _type - Element type (unused)
   * @param prevProps - Previous props
   * @param nextProps - New props
   * @returns Always true
   *
   * @example
   * ```typescript
   * // Button label changes:
   * <auxxbutton label="Click" /> → <auxxbutton label="Press" />
   *
   * // commitUpdate called:
   * commitUpdate(instance, 'auxxbutton', { label: 'Click' }, { label: 'Press' })
   * // → instance.props = { label: 'Press' }
   * // → tag.propsChanged.trigger({ prevProps, nextProps })
   * // → registerEventHandler receives event (no action needed, no handler change)
   * // → Next sanitization will call tag.getAttributes() with new props
   * ```
   */
  commitUpdate: (
    instance: ComponentInstance,
    _type: string,
    prevProps: Record<string, any>,
    nextProps: Record<string, any>
  ) => {
    // ✓ Skip if props haven't actually changed
    if (propsEqual(prevProps, nextProps)) {
      return true
    }

    // Update stored props
    instance.props = nextProps
    instance.component = nextProps['component']

    // Trigger propsChanged event for listeners (e.g., registerEventHandler)
    instance.tag.propsChanged.trigger({
      instance,
      prevProps,
      nextProps,
    })

    return true
  },

  // ==========================================
  // React 19 Stubs & Compatibility
  // ==========================================
  //
  // The following methods are required by React 19's reconciler interface
  // but are not needed for our virtual tree rendering. They are provided
  // as stubs with minimal implementations to satisfy TypeScript and the
  // reconciler's expectations.

  /** Called before active instance blurs (no-op for virtual tree) */
  beforeActiveInstanceBlur: noOp,

  /** Called after active instance blurs (no-op for virtual tree) */
  afterActiveInstanceBlur: noOp,

  /** Prepare for commit phase (returns null, no preparation needed) */
  prepareForCommit: always(null),

  /** Prepare portal mount (no-op, portals not implemented) */
  preparePortalMount: noOp,

  /** Prepare scope update (no-op, scopes not implemented) */
  prepareScopeUpdate: noOp,

  /** Get instance from scope (returns null, scopes not implemented) */
  getInstanceFromScope: always(null),

  /** Detach deleted instance (no-op, no detachment logic needed) */
  detachDeletedInstance: noOp,

  /** Get instance from DOM node (returns null, no DOM access) */
  getInstanceFromNode: always(null),

  // ==========================================
  // React 19 Transitions & Forms
  // ==========================================

  /** Indicates whether a transition is pending (always false) */
  NotPendingTransition: false,

  /** Context for tracking transitions (unused, empty context) */
  HostTransitionContext: React.createContext(undefined),

  /** Reset form instance (no-op, forms handled by tags) */
  resetFormInstance: noOp,

  /** Request callback after paint (no-op, no paint cycle in virtual tree) */
  requestPostPaintCallback: noOp,

  /** Whether to attempt eager transition (always false) */
  shouldAttemptEagerTransition: () => false,

  /** Track scheduler event (no-op, no event tracking) */
  trackSchedulerEvent: noOp,

  /** Resolve event type (returns null, not used) */
  resolveEventType: () => null,

  /** Resolve event timestamp (returns 0, not used) */
  resolveEventTimeStamp: () => 0,

  // ==========================================
  // React 19 Suspense & Streaming
  // ==========================================

  /** May suspend commit (always false, commits never suspend) */
  maySuspendCommit: () => false,

  /** Preload instance (always false, no preloading) */
  preloadInstance: () => false,

  /** Start suspending commit (no-op, commits never suspend) */
  startSuspendingCommit: noOp,

  /** Suspend instance (no-op, instances don't suspend) */
  suspendInstance: noOp,

  /** Wait for commit to be ready (returns null, commits always ready) */
  waitForCommitToBeReady: () => null,
})

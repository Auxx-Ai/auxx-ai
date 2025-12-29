// packages/sdk/src/runtime/reconciler/types.ts

/**
 * # Reconciler Type Definitions
 *
 * This file defines the core types used by the reconciler system for cross-iframe
 * communication and rendering.
 *
 * ## Key Types
 *
 * **SanitizedInstance**: The serializable output format sent to parent app via postMessage.
 * Stripped of functions, class instances, and other non-serializable data.
 *
 * **ReconcilerConfig**: Configuration for setting up the reconciler with callbacks.
 *
 * **RenderOptions**: Options passed to the render() function.
 *
 * ## Type Flow
 *
 * ```
 * ComponentInstance (with Tag, functions, classes)
 *          ↓ sanitization
 * SanitizedInstance (plain objects only)
 *          ↓ postMessage
 * Parent App (reconstructs UI)
 * ```
 *
 * @see packages/sdk/src/runtime/reconciler/host-config.ts - Defines ComponentInstance
 * @see packages/sdk/src/runtime/reconciler/sanitizer.ts - Converts to SanitizedInstance
 */

/**
 * Discriminator type for instance types in the sanitized tree.
 *
 * Used to differentiate between component instances and text nodes in the
 * serialized tree structure sent to the parent app.
 *
 * - `'instance'`: Custom component (auxxbutton, auxxform, etc.)
 * - `'text'`: Plain text node
 */
export type InstanceType = 'instance' | 'text'

/**
 * Sanitized instance representation for cross-iframe serialization.
 *
 * This is the **output format** of the reconciler after sanitization. All functions,
 * class instances, and non-serializable data have been removed or converted to
 * plain values. This structure can be safely sent via postMessage to the parent app.
 *
 * ## Differences from ComponentInstance
 *
 * **ComponentInstance** (internal, not serializable):
 * - Contains Tag instance (class)
 * - Has event handler functions
 * - Stores raw props with complex objects
 *
 * **SanitizedInstance** (external, serializable):
 * - No Tag instance (tag name as string)
 * - Event handlers indicated by `__has${EventName}` flags
 * - Only whitelisted attributes from tag.getAttributes()
 *
 * ## Structure
 *
 * For component instances (`instance_type: 'instance'`):
 * - `instance_id`: Unique ID for event handler lookup
 * - `tag`: HTML tag name to render (e.g., 'button', 'div')
 * - `component`: Component identifier (e.g., 'Button', 'Form')
 * - `attributes`: Serializable props from tag.getAttributes()
 * - `children`: Nested SanitizedInstance array
 *
 * For text nodes (`instance_type: 'text'`):
 * - `text`: The text content
 * - Other fields unused
 *
 * @example
 * ```typescript
 * // Component instance:
 * {
 *   instance_type: 'instance',
 *   instance_id: 123,
 *   tag: 'button',
 *   component: 'Button',
 *   attributes: {
 *     label: 'Click me',
 *     disabled: false,
 *     __hasOnClick: true  // Indicates onClick handler exists
 *   },
 *   children: []
 * }
 *
 * // Text node:
 * {
 *   instance_type: 'text',
 *   text: 'Hello World'
 * }
 * ```
 *
 * ## Parent App Reconstruction
 *
 * The parent app receives this structure and:
 * 1. Walks the tree recursively
 * 2. Creates actual React components based on `component` name
 * 3. Passes `attributes` as props
 * 4. For `__hasOnClick` flags, creates handler that sends message to iframe
 * 5. Reconstructs children recursively
 *
 * @property instance_type - Discriminator ('instance' or 'text')
 * @property instance_id - Unique ID for component instances (for event handler lookup)
 * @property tag - HTML tag name for rendering (e.g., 'button', 'input', 'div')
 * @property component - Component identifier (e.g., 'Button', 'Form', 'TextBlock')
 * @property attributes - Serializable attributes/props (from tag.getAttributes())
 * @property children - Nested child instances
 * @property text - Text content for text nodes
 *
 * @see ComponentInstance - Internal instance type with Tag and functions
 * @see sanitizer.ts - Converts ComponentInstance to SanitizedInstance
 * @see BaseTag.getAttributes() - Defines which props are serialized
 */
export interface SanitizedInstance {
  /** Type discriminator: 'instance' for components, 'text' for text nodes */
  instance_type: InstanceType

  /** Unique ID for component instances (used for event handler invocation) */
  instance_id?: number

  /** HTML tag name to render in parent app (e.g., 'button', 'div', 'form') */
  tag?: string

  /** Component identifier for parent app reconstruction (e.g., 'Button', 'Form') */
  component?: string

  /**
   * Serializable attributes/props for the component.
   *
   * Derived from tag.getAttributes() which explicitly whitelists serializable props.
   * Event handlers indicated by `__has${EventName}` boolean flags (e.g., __hasOnClick).
   */
  attributes?: Record<string, any>

  /** Nested child instances (recursively sanitized) */
  children?: SanitizedInstance[]

  /** Text content for text nodes (only when instance_type === 'text') */
  text?: string
}

/**
 * Configuration for initializing the reconciler.
 *
 * Provides callbacks for the reconciler to communicate with the parent app
 * and handle cross-iframe method invocations.
 *
 * @property onCommit - Called after React commits changes with sanitized tree
 * @property onCallInstanceMethod - Optional callback for parent app to invoke methods on instances
 *
 * @example
 * ```typescript
 * const config: ReconcilerConfig = {
 *   onCommit: (children) => {
 *     // Send sanitized tree to parent app
 *     Host.sendMessage('render', { root: { children } })
 *   },
 *   onCallInstanceMethod: async (instanceId, method, args) => {
 *     // Handle method invocation from parent app
 *     return eventBus.callTagEventListener(method, instanceId, args)
 *   }
 * }
 * ```
 *
 * @see packages/sdk/src/runtime/reconciler/reconciler.ts - Uses this config
 * @see packages/sdk/src/runtime/index.ts - Provides onCommit implementation
 */
export interface ReconcilerConfig {
  /**
   * Called after React commits all changes.
   *
   * Receives the sanitized tree (root children) that should be sent to parent app
   * via postMessage. This is the primary mechanism for updating the parent's UI.
   *
   * **When Called**: After resetAfterCommit() in reconciler commit phase
   *
   * **Flow**:
   * 1. React commits changes
   * 2. resetAfterCommit() calls container.onCommit()
   * 3. Sanitizer converts tree to SanitizedInstance[]
   * 4. This callback invoked with sanitized tree
   * 5. Runtime sends tree to parent via postMessage
   *
   * @param children - Sanitized root-level instances
   */
  onCommit: (children: SanitizedInstance[]) => void

  /**
   * Called when parent app wants to invoke a method on an instance.
   *
   * Enables cross-iframe event handling. Parent app sends instance ID and method name;
   * this callback looks up the tag and invokes the corresponding handler.
   *
   * **When Called**: When parent app forwards user interaction to iframe
   *
   * **Flow**:
   * 1. User clicks button in parent app
   * 2. Parent sends: { instanceId: 123, method: 'onClick', args: [] }
   * 3. Runtime calls this callback
   * 4. Callback looks up tag via getTagInstance(instanceId)
   * 5. EventBus invokes the registered onClick handler
   * 6. Result returned to parent app
   *
   * @param instanceId - The unique ID of the instance
   * @param method - The method name to invoke (e.g., 'onClick', 'onChange')
   * @param args - Arguments to pass to the method
   * @returns Promise resolving to method result
   *
   * @see getTagInstance - Looks up tag by instance ID
   * @see EventBus - Manages event handler registry
   */
  onCallInstanceMethod?: (instanceId: number, method: string, args: any[]) => Promise<any>
}

/**
 * Options for the render() function.
 *
 * Extends ReconcilerConfig with the React element to render.
 *
 * @property element - The React element to render into the virtual tree
 *
 * @example
 * ```typescript
 * const options: RenderOptions = {
 *   element: <MyApp />,
 *   onCommit: (children) => {
 *     Host.sendMessage('render', { root: { children } })
 *   },
 *   onCallInstanceMethod: async (id, method, args) => {
 *     return eventBus.callTagEventListener(method, id, args)
 *   }
 * }
 *
 * render(options)
 * ```
 *
 * @see packages/sdk/src/runtime/reconciler/reconciler.ts - render() function
 */
export interface RenderOptions extends ReconcilerConfig {
  /** The React element to render */
  element: React.ReactElement
}

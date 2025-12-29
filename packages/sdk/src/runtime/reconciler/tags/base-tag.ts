// packages/sdk/src/runtime/reconciler/tags/base-tag.ts

/**
 * # Base Tag Class for Custom Components
 *
 * This file defines the abstract BaseTag class that all custom component tags extend.
 * Each custom element type (auxxbutton, auxxform, etc.) has a corresponding Tag class
 * (ButtonTag, FormTag, etc.) that handles serialization, lifecycle, and event management.
 *
 * ## Purpose
 *
 * Tags serve as the **bridge** between React's ComponentInstance and the serializable
 * SanitizedInstance sent to the parent app. They:
 * 1. Define which props are serializable (via getAttributes())
 * 2. Provide HTML tag name and component identifier
 * 3. Handle lifecycle hooks (onCreate, onMount, onUpdate, onDestroy)
 * 4. Expose event brokers for lifecycle events
 * 5. Store event handlers for cross-iframe invocation
 *
 * ## Tag vs ComponentInstance
 *
 * **ComponentInstance** (in host-config):
 * - Created by React reconciler
 * - Holds reference to Tag instance
 * - Manages children array
 * - Used internally by reconciler
 *
 * **Tag** (this class):
 * - Created for each ComponentInstance
 * - Implements serialization logic
 * - Manages event handlers
 * - Provides lifecycle hooks
 *
 * ## Lifecycle Sequence
 *
 * ```
 * createInstance() in host-config
 *   ↓
 * new ButtonTag(props)
 *   ↓
 * tag.onCreate() - initialization
 *   ↓
 * registerTagInstance(tag) - add to global registry
 *   ↓
 * [Render phase completes]
 *   ↓
 * commitMount() in host-config
 *   ↓
 * tag.onMount({ instance_id }) - mounted lifecycle
 *   ↓
 * tag.mounted.trigger() - fire event broker
 *   ↓
 * registerEventHandler receives event - registers handlers in EventBus
 *   ↓
 * [Component updates]
 *   ↓
 * commitUpdate() in host-config
 *   ↓
 * tag.propsChanged.trigger({ prevProps, nextProps }) - props changed
 *   ↓
 * registerEventHandler updates EventBus - modify handlers if needed
 *   ↓
 * [Component unmounts]
 *   ↓
 * removeChild() in host-config
 *   ↓
 * tag.onDestroy() - cleanup lifecycle
 *   ↓
 * tag.destroyed.trigger() - fire event broker
 *   ↓
 * registerEventHandler receives event - clears handlers from EventBus
 *   ↓
 * unregisterTagInstance() - remove from global registry
 * ```
 *
 * ## Event Broker Pattern
 *
 * Tags use EventBroker for lifecycle events instead of direct callbacks:
 * - **mounted**: Fired when tag is mounted to tree
 * - **propsChanged**: Fired when props are updated
 * - **destroyed**: Fired when tag is removed from tree
 *
 * This allows multiple listeners (like registerEventHandler) to react to lifecycle events
 * without tight coupling.
 *
 * ## Creating New Tag Types
 *
 * To add a new custom component:
 * 1. Extend BaseTag
 * 2. Implement getTagName() - HTML tag name (e.g., 'button')
 * 3. Implement getComponentName() - Component identifier (e.g., 'Button')
 * 4. Implement getAttributes() - Whitelist serializable props
 * 5. Register in TAG_REGISTRY in tags/index.ts
 * 6. Call registerEventHandler() in constructor for event handlers
 *
 * @example
 * ```typescript
 * class ButtonTag extends BaseTag {
 *   constructor(props: Record<string, any>) {
 *     super(props)
 *     // Register event handlers
 *     registerEventHandler(this, 'onClick')
 *   }
 *
 *   getTagName() {
 *     return 'button'
 *   }
 *
 *   getComponentName() {
 *     return 'Button'
 *   }
 *
 *   getAttributes(props: Record<string, any>) {
 *     const { label, disabled, variant } = props
 *     return {
 *       label,
 *       disabled,
 *       variant,
 *       __hasOnClick: typeof props.onClick === 'function'
 *     }
 *   }
 * }
 * ```
 *
 * @see packages/sdk/src/runtime/reconciler/host-config.ts - Creates and uses Tag instances
 * @see packages/sdk/src/runtime/reconciler/tags/index.ts - TAG_REGISTRY of all tags
 * @see packages/sdk/src/runtime/register-event-handler.ts - Registers event handlers
 * @see packages/sdk/src/runtime/event-broker.ts - EventBroker implementation
 */

import { generateInstanceId } from '../instance-id.js'
import type { SanitizedInstance } from '../types.js'
import { EventBroker } from '../../event-broker.js'

/**
 * Abstract base class for all custom component tags.
 *
 * Each custom element type (auxxbutton, auxxform, etc.) has a corresponding Tag class
 * that extends BaseTag and implements serialization logic, lifecycle hooks, and event management.
 *
 * ## Responsibilities
 *
 * 1. **Serialization**: Define which props are serializable via getAttributes()
 * 2. **Identification**: Provide HTML tag name and component identifier
 * 3. **Lifecycle**: Implement onCreate/onMount/onUpdate/onDestroy hooks
 * 4. **Events**: Expose event brokers for lifecycle events (mounted, propsChanged, destroyed)
 * 5. **Handlers**: Store event handlers for cross-iframe invocation
 *
 * ## Abstract Methods
 *
 * Subclasses must implement:
 * - **getTagName()**: HTML tag name (e.g., 'button', 'div')
 * - **getComponentName()**: Component identifier (e.g., 'Button', 'Form')
 * - **getAttributes()**: Serialize props to plain objects
 *
 * ## Lifecycle Hooks
 *
 * Override these in subclasses if needed:
 * - **onCreate()**: Called when tag is created (before mounting)
 * - **onMount()**: Called when tag is mounted to tree (calls mounted event broker)
 * - **onUpdate()**: Called when props change (deprecated, use propsChanged broker)
 * - **onDestroy()**: Called when tag is removed from tree (calls destroyed event broker)
 *
 * ## Event Brokers
 *
 * - **mounted**: Triggered in onMount(), listened to by registerEventHandler
 * - **propsChanged**: Triggered by host-config commitUpdate(), listened to by registerEventHandler
 * - **destroyed**: Triggered in onDestroy(), listened to by registerEventHandler
 *
 * @example
 * ```typescript
 * class ButtonTag extends BaseTag {
 *   getTagName() { return 'button' }
 *   getComponentName() { return 'Button' }
 *   getAttributes(props) {
 *     return {
 *       label: props.label,
 *       disabled: props.disabled,
 *       __hasOnClick: typeof props.onClick === 'function'
 *     }
 *   }
 * }
 * ```
 */
export abstract class BaseTag {
  /**
   * Unique identifier for this instance.
   *
   * Generated via generateInstanceId() which maintains a global counter.
   * Used for:
   * - Event handler lookup in tagInstanceRegistry
   * - Cross-iframe communication (parent sends instanceId to invoke handlers)
   * - Instance identification in sanitized tree
   */
  public instanceId: number

  /**
   * Props passed to this component.
   *
   * Stores the raw props including event handlers, complex objects, etc.
   * getAttributes() is responsible for extracting serializable props from this.
   */
  public props: Record<string, any>

  /**
   * Child instances (tags or text strings).
   *
   * Note: This is an alternative child management approach not currently used by reconciler.
   * The reconciler manages children via ComponentInstance.children array.
   * This may be used by specific tag implementations if needed.
   */
  public children: (BaseTag | string)[] = []

  /**
   * Parent tag reference.
   *
   * Note: Not actively used by reconciler. May be used by specific tag implementations.
   */
  public parent: BaseTag | null = null

  /**
   * Event handlers stored for cross-iframe communication.
   *
   * **Deprecated**: This handlers map is not currently used. Event handlers are
   * managed by EventBus via registerEventHandler() instead.
   *
   * @deprecated Use EventBus via registerEventHandler() instead
   */
  private handlers: Map<string, Function> = new Map()

  /**
   * Event broker triggered when tag is mounted to tree.
   *
   * **When Triggered**: In onMount() after commitMount() is called by reconciler
   *
   * **Listeners**: registerEventHandler subscribes to this to register event handlers in EventBus
   *
   * **Payload**:
   * - instance: { instance_id: number } - The instance being mounted
   * - props: Current props
   *
   * @see registerEventHandler - Listens to this event
   * @see onMount - Triggers this event broker
   */
  public mounted = new EventBroker<{
    instance: { instance_id: number }
    props: Record<string, any>
  }>()

  /**
   * Event broker triggered when props change.
   *
   * **When Triggered**: By host-config commitUpdate() when React detects prop changes
   *
   * **Listeners**: registerEventHandler subscribes to this to update EventBus handlers
   *
   * **Payload**:
   * - instance: { instance_id: number } - The instance being updated
   * - prevProps: Previous props
   * - nextProps: New props
   *
   * @see commitUpdate in host-config - Triggers this event broker
   * @see registerEventHandler - Listens to this event
   */
  public propsChanged = new EventBroker<{
    instance: { instance_id: number }
    prevProps: Record<string, any>
    nextProps: Record<string, any>
  }>()

  /**
   * Event broker triggered when tag is destroyed.
   *
   * **When Triggered**: In onDestroy() when removeInstanceRecursive() is called
   *
   * **Listeners**: registerEventHandler subscribes to this to clear EventBus handlers
   *
   * **Payload**:
   * - instance: { instance_id: number } - The instance being destroyed
   * - props: Final props
   *
   * @see onDestroy - Triggers this event broker
   * @see registerEventHandler - Listens to this event
   * @see removeInstanceRecursive in host-config - Calls onDestroy
   */
  public destroyed = new EventBroker<{
    instance: { instance_id: number }
    props: Record<string, any>
  }>()

  /**
   * Construct a new Tag instance.
   *
   * Generates unique instance ID and stores props.
   *
   * **Subclass Pattern**: Subclasses should call super(props) then call
   * registerEventHandler() for each event handler:
   *
   * @example
   * ```typescript
   * constructor(props: Record<string, any>) {
   *   super(props)
   *   registerEventHandler(this, 'onClick')
   *   registerEventHandler(this, 'onChange')
   * }
   * ```
   *
   * @param props - Component props (including event handlers)
   */
  constructor(props: Record<string, any>) {
    this.instanceId = generateInstanceId()
    this.props = props
  }

  /**
   * Register an event handler and get its ID.
   * The handler will be stored and callable via callHandler().
   */
  protected registerHandler(handlerName: string, handler: Function): string {
    const handlerId = `${this.instanceId}:${handlerName}`
    this.handlers.set(handlerId, handler)
    return handlerId
  }

  /**
   * Call a registered handler by ID.
   * Returns the result of the handler.
   */
  public callHandler(handlerId: string, args: any[]): any {
    const handler = this.handlers.get(handlerId)
    if (!handler) {
      throw new Error(`Handler not found: ${handlerId}`)
    }
    return handler(...args)
  }

  /**
   * Check if a handler exists.
   */
  public hasHandler(handlerId: string): boolean {
    return this.handlers.has(handlerId)
  }

  /**
   * Get the HTML tag name to render in parent app.
   *
   * **Purpose**: Define which HTML element the parent app should create
   * when reconstructing the UI.
   *
   * **Examples**:
   * - ButtonTag → 'button'
   * - FormTag → 'form'
   * - TextBlockTag → 'div'
   * - BadgeTag → 'span'
   *
   * **Must Implement**: Every subclass must implement this method.
   *
   * @returns HTML tag name (e.g., 'button', 'div', 'span', 'input')
   *
   * @example
   * ```typescript
   * class ButtonTag extends BaseTag {
   *   getTagName() {
   *     return 'button'
   *   }
   * }
   * ```
   */
  abstract getTagName(): string

  /**
   * Get the component identifier for parent app reconstruction.
   *
   * **Purpose**: Tell parent app which React component to render.
   *
   * **Examples**:
   * - ButtonTag → 'Button'
   * - FormTag → 'Form'
   * - TextBlockTag → 'TextBlock'
   * - BadgeTag → 'Badge'
   *
   * **Must Implement**: Every subclass must implement this method.
   *
   * **Parent App Usage**: Parent looks up this component name in its registry
   * and renders the corresponding React component with the serialized attributes.
   *
   * @returns Component identifier (e.g., 'Button', 'Form', 'TextBlock')
   *
   * @example
   * ```typescript
   * class ButtonTag extends BaseTag {
   *   getComponentName() {
   *     return 'Button'
   *   }
   * }
   * ```
   */
  abstract getComponentName(): string

  /**
   * Extract serializable attributes from props.
   *
   * **Purpose**: Explicitly whitelist which props should be sent to parent app.
   * This is the **most critical method** for security and correctness.
   *
   * **Security**: Prevents functions, class instances, React internals, and sensitive
   * data from being sent via postMessage.
   *
   * **Event Handlers**: Cannot serialize functions, so use boolean flags:
   * - `__hasOnClick: typeof props.onClick === 'function'`
   * - Parent sees flag and creates proxy handler that sends message back to iframe
   *
   * **Must Implement**: Every subclass must implement this method and explicitly
   * extract each serializable prop.
   *
   * **Anti-Pattern**: DO NOT use `{ ...props }` or spread all props blindly.
   * Explicitly extract each prop you want to serialize.
   *
   * @param props - Raw props (may contain functions, complex objects, etc.)
   * @returns Plain object with only serializable props
   *
   * @example
   * ```typescript
   * class ButtonTag extends BaseTag {
   *   getAttributes(props: Record<string, any>) {
   *     const { label, disabled, variant, size } = props
   *     return {
   *       label,        // Serializable: string
   *       disabled,     // Serializable: boolean
   *       variant,      // Serializable: string
   *       size,         // Serializable: string
   *       __hasOnClick: typeof props.onClick === 'function'  // Flag for handler
   *     }
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // BAD - Don't do this!
   * getAttributes(props: Record<string, any>) {
   *   return { ...props }  // Sends everything, including functions!
   * }
   *
   * // GOOD - Explicit whitelisting
   * getAttributes(props: Record<string, any>) {
   *   return {
   *     value: props.value,
   *     placeholder: props.placeholder,
   *     __hasOnChange: typeof props.onChange === 'function'
   *   }
   * }
   * ```
   */
  abstract getAttributes(props: Record<string, any>): Record<string, any>

  /**
   * Append a child to this tag.
   */
  appendChild(child: BaseTag | string): void {
    this.children.push(child)

    if (typeof child !== 'string') {
      child.parent = this
    }
  }

  /**
   * Insert a child before another child.
   */
  insertBefore(child: BaseTag | string, beforeChild: BaseTag | string): void {
    const index = this.children.indexOf(beforeChild)
    if (index === -1) {
      this.appendChild(child)
      return
    }

    this.children.splice(index, 0, child)

    if (typeof child !== 'string') {
      child.parent = this
    }
  }

  /**
   * Remove a child from this tag.
   */
  removeChild(child: BaseTag | string): void {
    const index = this.children.indexOf(child)
    if (index === -1) {
      return
    }

    this.children.splice(index, 1)

    if (typeof child !== 'string') {
      child.parent = null
    }
  }

  /**
   * Update props on this tag.
   */
  updateProps(newProps: Record<string, any>): void {
    this.props = newProps
  }

  /**
   * Convert this tag to a sanitized instance for serialization.
   */
  toSanitizedInstance(): SanitizedInstance {
    return {
      instance_type: 'instance',
      instance_id: this.instanceId,
      tag: this.getTagName(),
      component: this.getComponentName(),
      attributes: this.getAttributes(this.props),
      children: this.children.map((child) => {
        if (typeof child === 'string') {
          return {
            instance_type: 'text',
            text: child,
          }
        }
        return child.toSanitizedInstance()
      }),
    }
  }

  /**
   * Lifecycle hook: Called immediately after tag is created.
   *
   * **When Called**: In createInstance() after new Tag(props) but before mounting
   *
   * **Purpose**: Initialization logic that needs to run before tag is mounted to tree.
   * Most tags don't need to override this.
   *
   * **Sequence**:
   * 1. new ButtonTag(props) - constructor runs
   * 2. tag.onCreate() - this method called
   * 3. registerTagInstance(tag) - added to registry
   * 4. [Render phase continues]
   * 5. commitMount() → tag.onMount() - mounted hook
   *
   * **Override**: Only override if you need pre-mount initialization.
   *
   * @example
   * ```typescript
   * onCreate() {
   *   super.onCreate()
   *   // Custom initialization logic
   *   console.log('Tag created:', this.instanceId)
   * }
   * ```
   */
  onCreate(): void {
    // Override in subclasses if needed
  }

  /**
   * Lifecycle hook: Called when tag is mounted to reconciler tree.
   *
   * **When Called**: In commitMount() after tag is added to tree and children are mounted
   *
   * **Purpose**: Triggers the `mounted` event broker which registerEventHandler
   * listens to for registering event handlers in EventBus.
   *
   * **Sequence**:
   * 1. React commit phase begins
   * 2. commitMount(instance) called by reconciler
   * 3. instance.tag.onMount({ instance_id }) - this method called
   * 4. this.mounted.trigger() - event broker fires
   * 5. registerEventHandler receives event
   * 6. Event handlers registered in EventBus
   *
   * **Override**: Only override if you need custom mount logic. MUST call
   * super.onMount(instance) to trigger event broker.
   *
   * @param instance - Object with instance_id property
   *
   * @example
   * ```typescript
   * onMount(instance: { instance_id: number }) {
   *   super.onMount(instance)  // MUST call super
   *   // Custom mount logic
   *   console.log('Mounted:', instance.instance_id)
   * }
   * ```
   *
   * @see commitMount in host-config - Calls this method
   * @see registerEventHandler - Listens to mounted event broker
   */
  onMount(instance: { instance_id: number }): void {
    this.mounted.trigger({ instance, props: this.props })
  }

  /**
   * Lifecycle hook: Called when props are updated.
   *
   * **Deprecated**: This method is deprecated in favor of listening to the
   * `propsChanged` event broker directly.
   *
   * **When Called**: Never called directly. The propsChanged event broker is
   * triggered by host-config commitUpdate() instead.
   *
   * **Migration**: Instead of overriding onUpdate, subscribe to propsChanged broker:
   *
   * @deprecated Listen to propsChanged event broker instead
   *
   * @example
   * ```typescript
   * // OLD (deprecated):
   * onUpdate(oldProps, newProps) {
   *   // React to prop changes
   * }
   *
   * // NEW (preferred):
   * constructor(props) {
   *   super(props)
   *   this.propsChanged.subscribe(({ prevProps, nextProps }) => {
   *     // React to prop changes
   *   })
   * }
   * ```
   *
   * @param oldProps - Previous props
   * @param newProps - New props
   */
  onUpdate(oldProps: Record<string, any>, newProps: Record<string, any>): void {
    this.propsChanged.trigger({
      instance: { instance_id: this.instanceId },
      prevProps: oldProps,
      nextProps: newProps,
    })
  }

  /**
   * Lifecycle hook: Called when tag is removed from reconciler tree.
   *
   * **When Called**: In removeInstanceRecursive() when instance is removed from tree
   *
   * **Purpose**: Cleanup and trigger `destroyed` event broker which registerEventHandler
   * listens to for clearing event handlers from EventBus.
   *
   * **Sequence**:
   * 1. React removes component
   * 2. removeChild(parent, child) called by reconciler
   * 3. removeInstanceRecursive(child) called
   * 4. child.tag.onDestroy() - this method called
   * 5. this.destroyed.trigger() - event broker fires
   * 6. registerEventHandler receives event
   * 7. Event handlers cleared from EventBus
   * 8. unregisterTagInstance(instanceId) - removed from registry
   *
   * **Override**: Only override if you need custom cleanup logic. MUST call
   * super.onDestroy() to trigger event broker.
   *
   * **Critical**: This must be called to prevent memory leaks. Event handlers
   * will remain in EventBus if this isn't called.
   *
   * @example
   * ```typescript
   * onDestroy() {
   *   super.onDestroy()  // MUST call super
   *   // Custom cleanup logic
   *   console.log('Destroyed:', this.instanceId)
   * }
   * ```
   *
   * @see removeInstanceRecursive in host-config - Calls this method
   * @see registerEventHandler - Listens to destroyed event broker
   * @see unregisterTagInstance - Called after this
   */
  onDestroy(): void {
    this.destroyed.trigger({
      instance: { instance_id: this.instanceId },
      props: this.props,
    })
  }
}

// packages/sdk/src/runtime/reconciler/sanitizer.ts

/**
 * # Tree Sanitization for Cross-Iframe Serialization
 *
 * This file converts the internal reconciler tree (ComponentInstance/TextInstance) to
 * a serializable format (SanitizedInstance) that can be sent via postMessage to the
 * parent app.
 *
 * ## Purpose
 *
 * The reconciler tree contains:
 * - Tag class instances
 * - Event handler functions
 * - React internals
 * - Complex objects
 *
 * None of these can cross the iframe boundary via postMessage. Sanitization:
 * 1. Extracts serializable props via tag.getAttributes()
 * 2. Converts Tag instances to plain objects with tag name strings
 * 3. Replaces event handlers with boolean flags (__hasOnClick, etc.)
 * 4. Filters out hidden instances (Suspense)
 * 5. Recursively processes entire tree
 *
 * ## Transformation
 *
 * ```
 * ComponentInstance                  SanitizedInstance
 * ├─ instance_type: 'instance'  →   ├─ instance_type: 'instance'
 * ├─ instance_id: 123           →   ├─ instance_id: 123
 * ├─ tag: ButtonTag {           →   ├─ tag: 'button'
 * │    getTagName: [Function],
 * │    props: { onClick: [Function] }
 * │  }
 * ├─ component: 'Button'        →   ├─ component: 'Button'
 * ├─ props: {                   →   ├─ attributes: {
 * │    label: 'Click',                    label: 'Click',
 * │    onClick: [Function],               __hasOnClick: true
 * │    __internal: {...}                }
 * │  }
 * ├─ hidden: false              →   (filtered if true)
 * └─ children: [...]            →   └─ children: [...]
 * ```
 *
 * ## When Called
 *
 * Called in container.onCommit() callback after React finishes committing changes:
 * 1. React calls resetAfterCommit(container)
 * 2. container.onCommit() invoked
 * 3. sanitize(container.children) called
 * 4. SanitizedInstance[] passed to user's onCommit callback
 * 5. Runtime sends to parent via postMessage
 *
 * ## Security Considerations
 *
 * **Critical**: This is the security boundary between extension and parent app.
 * - Only whitelisted props pass through (via tag.getAttributes())
 * - Functions cannot cross boundary
 * - Class instances cannot cross boundary
 * - No sensitive data should leak through
 *
 * ## Performance
 *
 * Sanitization is fast (pure JavaScript, no async) but runs on every commit.
 * Keep tag.getAttributes() implementations efficient.
 *
 * @see packages/sdk/src/runtime/reconciler/host-config.ts - ComponentInstance definition
 * @see packages/sdk/src/runtime/reconciler/types.ts - SanitizedInstance definition
 * @see packages/sdk/src/runtime/reconciler/tags/base-tag.ts - Tag.getAttributes()
 * @see packages/sdk/src/runtime/reconciler/reconciler.ts - Calls sanitize in onCommit
 */

import type { ComponentInstance, TextInstance } from './host-config.js'
import type { SanitizedInstance } from './types.js'

/**
 * Sanitize reconciler tree for cross-iframe serialization.
 *
 * Converts internal ComponentInstance/TextInstance tree to plain SanitizedInstance
 * objects that can be safely sent via postMessage.
 *
 * ## Process
 *
 * 1. **Filter Hidden**: Remove instances marked hidden (by Suspense, etc.)
 * 2. **Map Nodes**: Call sanitizeNode() on each visible instance
 * 3. **Return Array**: Return SanitizedInstance[] ready for postMessage
 *
 * ## Visibility Filtering
 *
 * Hidden instances (instance.hidden === true) are filtered out. This is used by
 * React Suspense to hide components that are suspended.
 *
 * ## Recursion
 *
 * Each node's children are recursively sanitized, building the full tree structure.
 *
 * @param children - Root-level instances from container.children
 * @returns Array of sanitized instances ready for serialization
 *
 * @example
 * ```typescript
 * const containerInfo: Container = {
 *   children: [
 *     // ComponentInstance with ButtonTag
 *     {
 *       instance_type: 'instance',
 *       instance_id: 123,
 *       tag: buttonTagInstance,
 *       component: 'Button',
 *       props: { label: 'Click', onClick: () => {} },
 *       hidden: false,
 *       children: []
 *     }
 *   ],
 *   onCommit: () => {
 *     const sanitized = sanitize(containerInfo.children)
 *     // sanitized = [{
 *     //   instance_type: 'instance',
 *     //   instance_id: 123,
 *     //   tag: 'button',
 *     //   component: 'Button',
 *     //   attributes: { label: 'Click', __hasOnClick: true },
 *     //   children: []
 *     // }]
 *     sendToParent(sanitized)
 *   }
 * }
 * ```
 *
 * @see sanitizeNode - Sanitizes individual nodes
 * @see ComponentInstance - Input type
 * @see SanitizedInstance - Output type
 */
export function sanitize(children: (ComponentInstance | TextInstance)[]): SanitizedInstance[] {
  const result = children
    .filter((child) => !child.hidden) // Remove hidden instances (Suspense, etc.)
    .map((child) => sanitizeNode(child)) // Convert to SanitizedInstance

  return result
}

/**
 * Sanitize a single node (ComponentInstance or TextInstance).
 *
 * Converts internal instance representation to plain serializable object.
 *
 * ## Process
 *
 * **For TextInstance**:
 * 1. Return simple object with instance_type='text' and text content
 *
 * **For ComponentInstance**:
 * 1. Call tag.getAttributes(props) to extract serializable props
 * 2. Create SanitizedInstance with:
 *    - instance_type: 'instance'
 *    - instance_id: unique ID for event handler lookup
 *    - tag: HTML tag name from tag.getTagName()
 *    - component: component identifier from instance.component
 *    - attributes: serialized props from tag.getAttributes()
 * 3. Recursively sanitize children if present
 * 4. Return SanitizedInstance
 *
 * ## Tag.getAttributes() Role
 *
 * The **most critical** part of sanitization is tag.getAttributes(). Each tag
 * explicitly whitelists which props are serializable:
 *
 * ```typescript
 * // ButtonTag.getAttributes()
 * getAttributes(props) {
 *   return {
 *     label: props.label,        // ✓ Serializable string
 *     disabled: props.disabled,  // ✓ Serializable boolean
 *     __hasOnClick: typeof props.onClick === 'function'  // ✓ Boolean flag
 *     // NOT included: onClick function itself
 *   }
 * }
 * ```
 *
 * ## Event Handler Flags
 *
 * Event handlers cannot be serialized, so tags use boolean flags:
 * - __hasOnClick: true → Parent knows onClick handler exists
 * - Parent creates proxy: onClick={() => sendToIframe(instanceId, 'onClick')}
 * - User clicks → Parent sends message to iframe
 * - Runtime looks up tag via getTagInstance(instanceId)
 * - EventBus invokes the actual handler
 *
 * @param node - ComponentInstance or TextInstance to sanitize
 * @returns SanitizedInstance ready for serialization
 *
 * @example
 * ```typescript
 * // Text node input:
 * const textNode: TextInstance = {
 *   instance_type: 'text',
 *   instance_id: 124,
 *   text: 'Hello World',
 *   hidden: false
 * }
 *
 * // Output:
 * const sanitized = sanitizeNode(textNode)
 * // { instance_type: 'text', text: 'Hello World' }
 * ```
 *
 * @example
 * ```typescript
 * // Component instance input:
 * const componentNode: ComponentInstance = {
 *   instance_type: 'instance',
 *   instance_id: 123,
 *   tag: buttonTagInstance,  // ButtonTag with getAttributes()
 *   component: 'Button',
 *   props: { label: 'Click', onClick: () => {}, disabled: false },
 *   hidden: false,
 *   children: []
 * }
 *
 * // Output:
 * const sanitized = sanitizeNode(componentNode)
 * // {
 * //   instance_type: 'instance',
 * //   instance_id: 123,
 * //   tag: 'button',
 * //   component: 'Button',
 * //   attributes: { label: 'Click', disabled: false, __hasOnClick: true },
 * //   children: []
 * // }
 * ```
 *
 * @see ComponentInstance - Input type for component nodes
 * @see TextInstance - Input type for text nodes
 * @see SanitizedInstance - Output type
 * @see BaseTag.getAttributes() - Extracts serializable props
 */
function sanitizeNode(node: ComponentInstance | TextInstance): SanitizedInstance {
  // Handle text nodes (simple case - just return text content)
  if (node.instance_type === 'text') {
    return {
      instance_type: 'text',
      text: node.text,
    }
  }

  // ComponentInstance: Extract serializable attributes via tag
  const attributes = node.tag.getAttributes(node.props)

  // Build sanitized instance with plain data only
  const sanitizedInstance: SanitizedInstance = {
    instance_type: 'instance',
    instance_id: node.instance_id, // For event handler lookup
    tag: node.tag.getTagName(), // HTML tag name ('button', 'div', etc.)
    component: node.component, // Component identifier ('Button', 'Form', etc.)
    attributes, // Serializable props from tag.getAttributes()
  }

  // Recursively sanitize children to build full tree structure
  if (node.children && node.children.length > 0) {
    sanitizedInstance.children = sanitize(node.children)
  }

  return sanitizedInstance
}

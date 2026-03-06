// packages/sdk/src/runtime/reconciler/tags/workflow-array-input-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for ArrayInput component.
 * Serializes the array field name + config. Children are serialized by the
 * reconciler as the item template, cloned per item on the host side.
 */
export class WorkflowArrayInputTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'ArrayInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { name, label, minItems, maxItems, addLabel, addPosition, canReorder } = props
    return { name, label, minItems, maxItems, addLabel, addPosition, canReorder }
  }
}

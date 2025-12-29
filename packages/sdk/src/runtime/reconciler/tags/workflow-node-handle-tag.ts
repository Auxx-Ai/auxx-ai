// packages/sdk/src/runtime/reconciler/tags/workflow-node-handle-tag.ts

import { BaseTag } from './base-tag.js'
import { registerEventHandler } from '../../register-event-handler.js'

/**
 * Tag for WorkflowNodeHandle component.
 * Connection handle for node inputs/outputs.
 */
export class WorkflowNodeHandleTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)

    // Register onConnect event handler if present
    registerEventHandler(this, 'onConnect')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowNodeHandle'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { type, id, position, className } = props

    return {
      type,
      id,
      position,
      className,
      __hasOnConnect: typeof props.onConnect === 'function',
    }
  }
}

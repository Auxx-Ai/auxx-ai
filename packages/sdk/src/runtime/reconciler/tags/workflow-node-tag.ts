// packages/sdk/src/runtime/reconciler/tags/workflow-node-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for WorkflowNode component.
 * Container for node visualization on canvas.
 */
export class WorkflowNodeTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowNode'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { className } = props

    return {
      className,
    }
  }
}

// packages/sdk/src/runtime/reconciler/tags/workflow-node-text-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for WorkflowNodeText component.
 * Text content within a workflow node.
 */
export class WorkflowNodeTextTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowNodeText'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { className } = props

    return {
      className,
    }
  }
}

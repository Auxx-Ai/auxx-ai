// packages/sdk/src/runtime/reconciler/tags/workflow-node-row-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for WorkflowNodeRow component.
 * A row within a workflow node with label and optional handle.
 */
export class WorkflowNodeRowTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowNodeRow'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { label, variant, className } = props

    return {
      label,
      variant,
      className,
    }
  }
}

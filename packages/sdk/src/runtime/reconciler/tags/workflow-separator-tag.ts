// packages/sdk/src/runtime/reconciler/tags/workflow-separator-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Separator component.
 * Visual divider for separating sections.
 */
export class WorkflowSeparatorTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowSeparator'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { className } = props

    return {
      className,
    }
  }
}

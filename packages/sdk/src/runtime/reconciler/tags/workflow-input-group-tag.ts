// packages/sdk/src/runtime/reconciler/tags/workflow-input-group-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for InputGroup component.
 * Layout container for arranging inputs horizontally.
 */
export class WorkflowInputGroupTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowInputGroup'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { gap, className } = props

    return {
      gap,
      className,
    }
  }
}

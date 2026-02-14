// packages/sdk/src/runtime/reconciler/tags/workflow-alert-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag class for WorkflowAlert component.
 * Serializes alert display props for cross-iframe communication.
 */
export class WorkflowAlertTag extends BaseTag {
  /**
   * Returns the HTML tag name to render.
   */
  getTagName(): string {
    return 'div'
  }

  /**
   * Returns the component name for registry lookup.
   */
  getComponentName(): string {
    return 'WorkflowAlert'
  }

  /**
   * Extracts and returns serializable attributes.
   */
  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant, title, className } = props

    return {
      variant,
      title,
      className,
    }
  }
}

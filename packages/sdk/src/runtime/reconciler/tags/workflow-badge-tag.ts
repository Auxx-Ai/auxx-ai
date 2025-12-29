// packages/sdk/src/runtime/reconciler/tags/workflow-badge-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag class for WorkflowBadge component.
 * Serializes badge display props for cross-iframe communication.
 */
export class WorkflowBadgeTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

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
    return 'WorkflowBadge'
  }

  /**
   * Extracts and returns serializable attributes.
   */
  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant, className } = props

    return {
      variant,
      className,
    }
  }
}

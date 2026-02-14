// packages/sdk/src/runtime/reconciler/tags/workflow-section-tag.ts

import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for Section component.
 * Collapsible section for grouping related fields.
 */
export class WorkflowSectionTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    // Register onToggle event handler for collapsible sections
    registerEventHandler(this, 'onToggle')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowSection'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { title, description, collapsible, defaultOpen, className } = props

    return {
      title,
      description,
      collapsible,
      defaultOpen,
      className,
      __hasOnToggle: typeof props.onToggle === 'function',
    }
  }
}

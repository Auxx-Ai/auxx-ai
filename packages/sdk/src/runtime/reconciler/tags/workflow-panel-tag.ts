// packages/sdk/src/runtime/reconciler/tags/workflow-panel-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for WorkflowPanel component.
 * Container for configuration panel.
 */
export class WorkflowPanelTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowPanel'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { className } = props

    return {
      className,
    }
  }
}

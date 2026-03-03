// packages/sdk/src/runtime/reconciler/tags/workflow-field-divider-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for FieldDivider component.
 * Renders a 1px vertical separator inside FieldRow — purely declarative, no event handlers.
 */
export class WorkflowFieldDividerTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowFieldDivider'
  }

  getAttributes(_props: Record<string, any>): Record<string, any> {
    return {}
  }
}

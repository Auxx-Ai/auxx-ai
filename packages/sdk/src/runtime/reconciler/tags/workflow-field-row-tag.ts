// packages/sdk/src/runtime/reconciler/tags/workflow-field-row-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for FieldRow component.
 * Renders a horizontal flex-row container inside VarFieldGroup — purely declarative, no event handlers.
 */
export class WorkflowFieldRowTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowFieldRow'
  }

  getAttributes(_props: Record<string, any>): Record<string, any> {
    return {}
  }
}

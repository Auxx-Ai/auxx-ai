// packages/sdk/src/runtime/reconciler/tags/workflow-var-field-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for VarField component.
 * Renders VarEditorFieldRow wrapper — purely declarative, no event handlers.
 */
export class WorkflowVarFieldTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowVarField'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { name, title, description, required, type, showIcon } = props

    return {
      name,
      title,
      description,
      required,
      type,
      showIcon,
    }
  }
}

// packages/sdk/src/runtime/reconciler/tags/workflow-var-field-group-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for VarFieldGroup component.
 * Renders VarEditorField container — purely declarative, no event handlers.
 */
export class WorkflowVarFieldGroupTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'WorkflowVarFieldGroup'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { orientation, validationError, validationType } = props

    return {
      orientation,
      validationError,
      validationType,
    }
  }
}

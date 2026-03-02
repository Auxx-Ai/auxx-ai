// packages/sdk/src/runtime/reconciler/tags/workflow-var-input-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for VarInput component.
 * Renders VarEditor for any BaseType — purely declarative, no event handlers.
 * The host reads/writes through AppWorkflowFieldContext.
 */
export class WorkflowVarInputTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'VarInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { name, type, placeholder, acceptsVariables, variableTypes, format, options, multiline } =
      props

    return {
      name,
      type,
      placeholder,
      acceptsVariables,
      variableTypes,
      format,
      options,
      multiline,
    }
  }
}

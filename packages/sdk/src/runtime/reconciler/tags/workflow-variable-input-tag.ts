// packages/sdk/src/runtime/reconciler/tags/workflow-variable-input-tag.ts

import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for VariableInput component.
 * Variable selector component for workflow forms.
 */
export class WorkflowVariableInputTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onVariableSelect')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'VariableInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const {
      variableId,
      nodeId,
      allowedTypes,
      placeholder,
      disabled,
      className,
      popoverWidth,
      popoverHeight,
      showFavorites,
      showRecent,
    } = props

    return {
      variableId,
      nodeId,
      allowedTypes,
      placeholder,
      disabled,
      className,
      popoverWidth,
      popoverHeight,
      showFavorites,
      showRecent,
      __hasOnVariableSelect: typeof props.onVariableSelect === 'function',
    }
  }
}

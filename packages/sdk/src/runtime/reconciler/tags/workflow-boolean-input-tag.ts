// packages/sdk/src/runtime/reconciler/tags/workflow-boolean-input-tag.ts

import { BaseTag } from './base-tag.js'
import { registerEventHandler } from '../../register-event-handler.js'

/**
 * Tag for BooleanInput component.
 * Boolean input component for workflow forms.
 */
export class WorkflowBooleanInputTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onChange')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'BooleanInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    // ✓ Explicitly whitelist only serializable props
    const {
      name,
      value,
      label,
      description,
      disabled,
    } = props

    return {
      name,
      value,
      label,
      description,
      disabled,
      __hasOnChange: typeof props.onChange === 'function',
    }
  }
}

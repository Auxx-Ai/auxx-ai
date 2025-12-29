// packages/sdk/src/runtime/reconciler/tags/workflow-select-input-tag.ts

import { BaseTag } from './base-tag.js'
import { registerEventHandler } from '../../register-event-handler.js'

/**
 * Tag for SelectInput component.
 * Select input component for workflow forms.
 */
export class WorkflowSelectInputTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onChange')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'SelectInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    // ✓ Explicitly whitelist only serializable props
    const {
      name,
      value,
      label,
      description,
      placeholder,
      disabled,
      options,
    } = props

    return {
      name,
      value,
      label,
      description,
      placeholder,
      disabled,
      options,
      __hasOnChange: typeof props.onChange === 'function',
    }
  }
}

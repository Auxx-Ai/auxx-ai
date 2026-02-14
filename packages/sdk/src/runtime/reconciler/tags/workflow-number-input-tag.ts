// packages/sdk/src/runtime/reconciler/tags/workflow-number-input-tag.ts

import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for NumberInput component.
 * Number input component for workflow forms.
 */
export class WorkflowNumberInputTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onChange')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'NumberInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    // ✓ Explicitly whitelist only serializable props
    const { name, value, label, description, placeholder, disabled, min, max, step } = props

    return {
      name,
      value,
      label,
      description,
      placeholder,
      disabled,
      min,
      max,
      step,
      __hasOnChange: typeof props.onChange === 'function',
    }
  }
}

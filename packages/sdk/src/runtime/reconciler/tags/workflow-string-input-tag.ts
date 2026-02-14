// packages/sdk/src/runtime/reconciler/tags/workflow-string-input-tag.ts

import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for StringInput component.
 * String input component for workflow forms.
 */
export class WorkflowStringInputTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onChange')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'StringInputInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    // ✓ Explicitly whitelist only serializable props
    const { name, value, label, description, placeholder, disabled, multiline, rows } = props

    return {
      name,
      value,
      label,
      description,
      placeholder,
      disabled,
      multiline,
      rows,
      __hasOnChange: typeof props.onChange === 'function',
    }
  }
}

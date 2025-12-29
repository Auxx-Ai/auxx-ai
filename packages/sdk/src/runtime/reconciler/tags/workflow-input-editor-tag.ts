// packages/sdk/src/runtime/reconciler/tags/workflow-input-editor-tag.ts

import { BaseTag } from './base-tag.js'
import { registerEventHandler } from '../../register-event-handler.js'

/**
 * Tag for InputEditor component.
 * Rich text editor with variable insertion support for workflow forms.
 */
export class WorkflowInputEditorTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)
    registerEventHandler(this, 'onChange')
    registerEventHandler(this, 'onBlur')
    registerEventHandler(this, 'onFocus')
  }

  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'InputEditorInternal'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { value, nodeId, placeholder, multiline, rows, disabled, className } = props

    return {
      value,
      nodeId,
      placeholder,
      multiline,
      rows,
      disabled,
      className,
      __hasOnChange: typeof props.onChange === 'function',
      __hasOnBlur: typeof props.onBlur === 'function',
      __hasOnFocus: typeof props.onFocus === 'function',
    }
  }
}

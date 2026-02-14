// packages/sdk/src/runtime/reconciler/tags/button-tag.ts

import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for Button component.
 * Registers onClick handler via lifecycle system.
 */
export class ButtonTag extends BaseTag {
  constructor(props: Record<string, any>) {
    super(props)

    // Register onClick event handler
    // This will automatically handle mount/update/destroy lifecycle
    registerEventHandler(this, 'onClick')
  }

  getTagName(): string {
    return 'button'
  }

  getComponentName(): string {
    return 'Button'
  }

  /**
   * Explicitly define allowed attributes.
   * This prevents unwanted props from leaking through.
   */
  getAttributes(props: Record<string, any>): Record<string, any> {
    console.log('[ButtonTag.getAttributes] Input props:', props)
    const { disabled, label, variant, keyboardHint, icon, loading, loadingText } = props

    const result = {
      disabled,
      label,
      variant,
      keyboardHint,
      icon,
      loading,
      loadingText,
      __hasOnClick: typeof props.onClick === 'function',
    }

    console.log('[ButtonTag.getAttributes] Output:', result)
    return result
  }
}

// packages/sdk/src/runtime/reconciler/tags/form-submit-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for FormSubmit button.
 */
export class FormSubmitTag extends BaseTag {
  getTagName(): string {
    return 'button'
  }

  getComponentName(): string {
    return 'FormSubmit'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant, loadingText, disabled } = props

    return {
      variant: variant || 'default',
      loadingText,
      disabled: disabled ?? false,
    }
  }
}

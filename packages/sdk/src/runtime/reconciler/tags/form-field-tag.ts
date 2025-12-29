// packages/sdk/src/runtime/reconciler/tags/form-field-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for FormField component.
 * Passes field configuration to web app for rendering.
 */
export class FormFieldTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'FormField'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { name, label, placeholder, description, disabled } = props

    if (!name) {
      throw new Error('FormField requires a "name" prop')
    }

    if (!label) {
      throw new Error(`FormField "${name}" requires a "label" prop`)
    }

    return {
      name,
      label,
      placeholder,
      description,
      disabled: disabled ?? false,
    }
  }
}

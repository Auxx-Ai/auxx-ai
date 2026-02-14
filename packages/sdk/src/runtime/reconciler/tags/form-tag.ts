// packages/sdk/src/runtime/reconciler/tags/form-tag.ts

import type { FormSchema } from '../../../client/forms/types.js'
import { serializeSchema } from '../../../client/forms/utils/serialize.js'
import { validateFormFields } from '../../../client/forms/utils/validation.js'
import { registerEventHandler } from '../../register-event-handler.js'
import { BaseTag } from './base-tag.js'

/**
 * Tag for Form component.
 * Serializes the schema and registers event handlers.
 */
export class FormTag extends BaseTag {
  private internalRef: any

  constructor(props: Record<string, any>) {
    super(props)

    // Register event handlers via lifecycle system
    registerEventHandler(this, 'onSubmit')
    registerEventHandler(this, 'onChange')
    registerEventHandler(this, 'onError')
    registerEventHandler(this, 'onValidationError')

    // Store internal ref for form control
    this.internalRef = props.__internalRef
  }

  getTagName(): string {
    return 'form'
  }

  getComponentName(): string {
    return 'Form'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { schema, formId, defaultValues, mode } = props

    if (!schema) {
      throw new Error('Form component requires a "schema" prop')
    }

    // Validate schema
    if (typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error('Form schema must be an object')
    }

    // Serialize the FormValue schema to JSON
    let serializedSchema
    try {
      serializedSchema = serializeSchema(schema as FormSchema)
    } catch (error: any) {
      throw new Error(`Failed to serialize form schema: ${error.message}`)
    }

    // Validate that all FormFields reference valid schema keys
    // Note: children are added after construction, so we validate in onMount
    this.mounted.addListener(() => {
      try {
        validateFormFields(this.children, schema as FormSchema)
      } catch (error) {
        console.error('[FormTag] Validation error:', error)
        throw error
      }
    })

    return {
      schema: serializedSchema,
      formId,
      defaultValues,
      mode: mode || 'onBlur',
      __hasOnSubmit: typeof props.onSubmit === 'function',
      __hasOnChange: typeof props.onChange === 'function',
      __hasOnError: typeof props.onError === 'function',
      __hasOnValidationError: typeof props.onValidationError === 'function',
    }
  }

  /**
   * Override toSanitizedInstance to add form control methods.
   */
  toSanitizedInstance() {
    const instance = super.toSanitizedInstance()

    // Attach form control interface
    if (this.internalRef?.current) {
      this.internalRef.current = {
        reset: () => {
          // Will be implemented on web app side
          console.log('[FormTag] reset() called - not yet implemented')
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        setValue: (_name: string, _value: any) => {
          console.log('[FormTag] setValue() called - not yet implemented')
        },
        validate: async () => {
          console.log('[FormTag] validate() called - not yet implemented')
          return false
        },
        getValues: () => {
          console.log('[FormTag] getValues() called - not yet implemented')
          return {}
        },
        submit: () => {
          console.log('[FormTag] submit() called - not yet implemented')
        },
      }
    }

    return instance
  }
}

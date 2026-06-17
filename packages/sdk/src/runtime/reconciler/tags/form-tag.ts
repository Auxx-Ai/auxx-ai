// packages/sdk/src/runtime/reconciler/tags/form-tag.ts

import type { FormSchema, PickerLoadOptions } from '../../../client/forms/types.js'
import { serializeSchema } from '../../../client/forms/utils/serialize.js'
import { validateFormFields } from '../../../client/forms/utils/validation.js'
import { eventBus } from '../../event-bus.js'
import { registerEventHandler } from '../../register-event-handler.js'
import { wrapEventHandler } from '../../wrap-event-handler.js'
import { BaseTag } from './base-tag.js'

/** Event-name prefix for a picker field's async option resolver (see host `AsyncOptionPicker`). */
const LOAD_OPTIONS_PREFIX = 'loadOptions:'

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

    // Register each picker field's `loadOptions` as an invokable instance method
    // (`loadOptions:<field>`) so the host's `AsyncOptionPicker` can resolve
    // options over the existing `call-instance-method` bridge. The resolver is a
    // runtime-only closure (stripped from the serialized schema), so it lives
    // here, keyed by the form's instance id.
    this.registerPickerLoadOptions(props.schema)

    // Store internal ref for form control
    this.internalRef = props.__internalRef
  }

  /** Collect `{ fieldName, loadOptions }` for every picker field with a resolver. */
  private pickerResolvers(
    schema: unknown
  ): Array<{ name: string; loadOptions: PickerLoadOptions }> {
    if (!schema || typeof schema !== 'object') return []
    const out: Array<{ name: string; loadOptions: PickerLoadOptions }> = []
    for (const [name, field] of Object.entries(schema as Record<string, any>)) {
      if (field?.type === 'picker' && typeof field._metadata?.loadOptions === 'function') {
        out.push({ name, loadOptions: field._metadata.loadOptions })
      }
    }
    return out
  }

  private registerPickerLoadOptions(schema: unknown): void {
    const resolvers = this.pickerResolvers(schema)
    if (resolvers.length === 0) return

    this.mounted.addListener(({ instance }) => {
      for (const { name, loadOptions } of resolvers) {
        const eventName = `${LOAD_OPTIONS_PREFIX}${name}`
        eventBus.setTagEventListener(
          eventName,
          instance.instance_id,
          wrapEventHandler((query: string) => loadOptions(query ?? ''), { eventName })
        )
      }
    })

    this.destroyed.addListener(({ instance }) => {
      for (const { name } of resolvers) {
        eventBus.clearTagEventListener(`${LOAD_OPTIONS_PREFIX}${name}`, instance.instance_id)
      }
    })
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

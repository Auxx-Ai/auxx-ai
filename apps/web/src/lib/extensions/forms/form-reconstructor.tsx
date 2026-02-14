// apps/web/src/lib/extensions/forms/form-reconstructor.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
// import { zodResolver } from '@hookform/resolvers/zod'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import React, { useEffect } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { getComponent } from '../component-registry'
import { deserializeSchema } from './deserialize-schema'
import { handleFormError } from './error-handler'
import { FieldRenderer } from './field-renderer'
import type { FormValidationMode, SerializedSchema } from './types'

interface FormProps {
  /** Serialized schema from SDK */
  schema: SerializedSchema

  /** Form instance ID */
  __instanceId: number

  /** Callback to call extension's event handlers */
  __onCallHandler: (instanceId: number, eventName: string, args?: any[]) => Promise<any>

  /** Whether form has event handlers */
  __hasOnSubmit: boolean
  __hasOnChange: boolean
  __hasOnError: boolean
  __hasOnValidationError: boolean

  /** Default values */
  defaultValues?: Record<string, any>

  /** Form ID */
  formId?: string

  /** Validation mode */
  mode?: FormValidationMode

  /** Children (FormField instances) */
  children?: any[]
}

/**
 * Form component.
 * Reconstructs a Form from SDK into real shadcn + React Hook Form.
 * This is used in the component registry.
 */
export const Form = React.memo(function Form({
  schema,
  __instanceId,
  __onCallHandler,
  __hasOnSubmit,
  __hasOnChange,
  __hasOnError,
  __hasOnValidationError,
  defaultValues,
  mode = 'onTouched',
  children,
}: FormProps) {
  // Deserialize schema to Zod
  const zodSchema = deserializeSchema(schema.fields)

  // Helper to reconstruct non-form components (TextBlock, Button, etc.)
  const reconstructChild = (child: any, key: number): React.ReactNode => {
    const Component = getComponent(child.component)

    if (!Component) {
      console.warn(`[Form] Unknown component: ${child.component}`)
      return null
    }

    // Recursively reconstruct any nested children
    const reconstructedChildren = child.children?.map((nestedChild: any, i: number) => {
      if (nestedChild.instance_type === 'text') {
        return nestedChild.text
      }
      return reconstructChild(nestedChild, i)
    })

    return React.createElement(
      Component,
      { key, ...child.attributes },
      ...(reconstructedChildren || [])
    )
  }

  // Create React Hook Form instance
  const form = useForm({
    resolver: standardSchemaResolver(zodSchema),
    defaultValues: defaultValues || {},
    mode: mode,
  })

  // Track if form is currently submitting
  const isSubmitting = form.formState.isSubmitting

  // Handle form changes
  useEffect(() => {
    if (__hasOnChange && __onCallHandler) {
      const subscription = form.watch((values) => {
        console.log('[Form] Form values changed:', values)
        __onCallHandler(__instanceId, 'onChange', [values]).catch((error) => {
          console.error('[Form] onChange error:', error)
        })
      })

      return () => subscription.unsubscribe()
    }
  }, [__hasOnChange, __onCallHandler, __instanceId, form])

  // Handle form submission
  const handleSubmit = form.handleSubmit(
    async (values) => {
      if (!__hasOnSubmit || !__onCallHandler) {
        return
      }

      console.log('[Form] Submitting form with values:', values)

      try {
        await __onCallHandler(__instanceId, 'onSubmit', [values])
        console.log('[Form] Form submitted successfully')
      } catch (error) {
        console.error('[Form] Form submission error:', error)

        // Call onError handler if provided
        if (__hasOnError) {
          await __onCallHandler(__instanceId, 'onError', [error]).catch((e) => {
            console.error('[Form] onError handler failed:', e)
          })
        }

        // Show error toast
        handleFormError(error as Error, 'Form submission')
      }
    },
    async (errors) => {
      console.warn('[Form] Validation errors:', errors)

      // Call onValidationError handler if provided
      if (__hasOnValidationError && __onCallHandler) {
        // Convert FieldErrors to simple Record<string, string>
        const errorMessages: Record<string, string> = {}
        for (const [field, error] of Object.entries(errors)) {
          if (error?.message) {
            errorMessages[field] = error.message as string
          }
        }

        await __onCallHandler(__instanceId, 'onValidationError', [errorMessages]).catch((error) => {
          console.error('[Form] onValidationError handler failed:', error)
        })
      }
    }
  )

  // Wrap handleSubmit to catch any unhandled promise rejections
  const onSubmit = (e: React.FormEvent) => {
    handleSubmit(e).catch((error) => {
      console.error('[Form] Uncaught form submission error:', error)
      // This should not normally happen as errors are handled above,
      // but this prevents uncaught promise rejections
    })
  }

  // Expose form control methods (for FormRef)
  // Note: This would require a way to communicate back to the SDK
  // For now, we'll log when these would be called
  useEffect(() => {
    console.log('[Form] Form control methods available:', {
      reset: form.reset,
      setValue: form.setValue,
      trigger: form.trigger,
      getValues: form.getValues,
    })
  }, [form])

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} className='space-y-6' noValidate>
        {/* Render form children */}
        {children?.map((child: any, index: number) => {
          // Handle FormField specially (needs schema)
          if (child.component === 'FormField') {
            const fieldSchema = schema.fields[child.attributes.name]

            if (!fieldSchema) {
              console.warn(`[Form] Field "${child.attributes.name}" not found in schema`)
              return null
            }

            return (
              <FieldRenderer
                key={index}
                name={child.attributes.name}
                label={child.attributes.label}
                placeholder={child.attributes.placeholder}
                description={child.attributes.description}
                disabled={child.attributes.disabled}
                fieldSchema={fieldSchema}
              />
            )
          }

          // Handle FormSubmit specially (needs loading state)
          if (child.component === 'FormSubmit') {
            return (
              <Button
                key={index}
                type='submit'
                variant={child.attributes.variant || 'default'}
                disabled={child.attributes.disabled}
                loading={isSubmitting}
                loadingText={child.attributes.loadingText}>
                {child.children?.[0]?.text || 'Submit'}
              </Button>
            )
          }

          // For all other components (TextBlock, Separator, etc.)
          // Reconstruct them normally using component registry
          return reconstructChild(child, index)
        })}
      </form>
    </FormProvider>
  )
})

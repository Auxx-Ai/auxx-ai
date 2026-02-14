// packages/sdk/src/client/components/form.tsx

import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import type { FormSchema, InferFormValues } from '../forms/types.js'

/**
 * Form validation mode.
 */
export type FormValidationMode =
  | 'onChange' // Validate on every change
  | 'onBlur' // Validate when field loses focus (default)
  | 'onSubmit' // Validate only on submit
  | 'onTouched' // Validate after first blur
  | 'all' // Validate on all events

/**
 * Form reference for imperative control.
 * Allows extensions to programmatically control the form.
 */
export interface FormRef<S extends FormSchema> {
  /** Reset the form to default values */
  reset: () => void

  /** Set a field value programmatically */
  setValue: <K extends keyof InferFormValues<S>>(name: K, value: InferFormValues<S>[K]) => void

  /** Trigger validation manually */
  validate: () => Promise<boolean>

  /** Get current form values */
  getValues: () => InferFormValues<S>

  /** Submit the form programmatically */
  submit: () => void
}

export interface FormProps<S extends FormSchema = FormSchema> {
  /** Form schema definition */
  schema: S

  /** Form submission handler */
  onSubmit: (values: InferFormValues<S>) => void | Promise<void>

  /** Form change handler (called on any field change) */
  onChange?: (values: Partial<InferFormValues<S>>) => void

  /** Error handler (called when submission fails) */
  onError?: (error: Error) => void

  /** Validation error handler (called when validation fails) */
  onValidationError?: (errors: Record<string, string>) => void

  /** Form ID (optional, for managing multiple forms) */
  formId?: string

  /** Default values */
  defaultValues?: Partial<InferFormValues<S>>

  /** Validation mode (default: onBlur) */
  mode?: FormValidationMode

  /** Children (FormField components) */
  children: React.ReactNode

  /** Component identifier (internal) */
  component?: 'Form'
}

/**
 * Form component for extensions.
 * This is a custom element that gets serialized by the reconciler
 * and reconstructed in the web app with real form handling.
 *
 * @example
 * const schema = {
 *   name: Forms.string(),
 *   email: Forms.string().email()
 * }
 *
 * const formRef = useRef<FormRef<typeof schema>>(null)
 *
 * function MyForm() {
 *   return (
 *     <Form
 *       schema={schema}
 *       ref={formRef}
 *       onSubmit={handleSubmit}
 *       onChange={(values) => console.log('Changed:', values)}
 *     >
 *       <FormField name="name" label="Full Name" />
 *       <FormField name="email" label="Email Address" />
 *       <FormSubmit>Submit</FormSubmit>
 *     </Form>
 *   )
 * }
 */
function FormComponent<S extends FormSchema>(props: FormProps<S>, ref: React.Ref<FormRef<S>>) {
  // Internal ref for form control methods
  const internalRef = useRef<any>(null)

  // Expose form control methods to parent
  useImperativeHandle(ref, () => ({
    reset: () => internalRef.current?.reset?.(),
    setValue: (name, value) => internalRef.current?.setValue?.(name, value),
    validate: async () => internalRef.current?.validate?.() ?? false,
    getValues: () => internalRef.current?.getValues?.() ?? {},
    submit: () => internalRef.current?.submit?.(),
  }))

  // This is a custom element - the reconciler will handle serialization
  return React.createElement('auxxform', {
    ...props,
    component: 'Form',
    __internalRef: internalRef,
  })
}

export const Form = forwardRef(FormComponent) as <S extends FormSchema>(
  props: FormProps<S> & { ref?: React.Ref<FormRef<S>> }
) => React.ReactElement

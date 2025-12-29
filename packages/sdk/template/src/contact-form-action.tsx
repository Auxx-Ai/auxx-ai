// packages/sdk/template/src/contact-form-action.tsx

import { useRef } from 'react'
import {
  Forms,
  Form,
  TextBlock,
  FormField,
  FormSubmit,
  showDialog,
  type FormRef,
  type InferFormValues,
  type RecordAction,
  type RecordActionContext,
  type DialogComponent,
} from '@auxx/sdk/client'

/**
 * Form schema for the contact form
 */
const contactFormSchema = {
  name: Forms.string().minLength(2, 'Name must be at least 2 characters').placeholder('John Doe'),

  email: Forms.string().email('Please enter a valid email address').placeholder('john@example.com'),

  phone: Forms.string().optional().placeholder('(555) 123-4567'),

  message: Forms.string()
    .multiline()
    .minLength(10, 'Message must be at least 10 characters')
    .maxLength(500, 'Message cannot exceed 500 characters')
    .placeholder('How can we help you?'),

  priority: Forms.select([
    { value: 'low', label: 'Low Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'high', label: 'High Priority' },
  ]).default('medium'),

  urgent: Forms.boolean().default(false),
}

/**
 * Contact form dialog component.
 * This component will be displayed in a dialog when the action is triggered.
 */
function ContactFormDialog({ hideDialog }: { hideDialog: () => void }) {
  const formRef = useRef<FormRef<typeof contactFormSchema>>(null)

  async function handleSubmit(values: InferFormValues<typeof contactFormSchema>) {
    console.log('Contact form submitted:', values)

    // TODO: Send the contact form data to your backend API
    // await serverFunctions.submitContactForm(values)

    // Close the dialog after successful submission
    hideDialog()
  }

  function handleError(error: Error) {
    console.error('Failed to submit contact form:', error)
    // Error will be shown as a toast automatically
  }

  return (
    <Form
      schema={contactFormSchema}
      ref={formRef}
      onSubmit={handleSubmit}
      onError={handleError}
      mode="onBlur"
    >
      <TextBlock>Lalala</TextBlock>
      <FormField name="name" label="Full Name" description="Your full name" />

      <FormField name="email" label="Email Address" description="We'll respond to this email" />

      <FormField name="phone" label="Phone Number" description="Optional - for urgent matters" />

      <FormField name="message" label="Message" description="Describe your inquiry or request" />

      <FormField name="priority" label="Priority Level" description="How urgent is your request?" />

      <FormField
        name="urgent"
        label="Mark as urgent"
        description="Check if this requires immediate attention"
      />

      <FormSubmit loadingText="Submitting...">Submit Contact Form</FormSubmit>
    </Form>
  )
}

/**
 * Record action that opens a dialog with the contact form.
 *
 * This action will appear on ticket records and allows users
 * to submit a contact form related to that ticket.
 */
export const contactFormAction: RecordAction = {
  id: 'contact-form-action',
  label: 'Send Contact Form',
  description: 'Open a contact form dialog',

  /**
   * Called when the action is triggered from a record.
   */
  async onTrigger({ recordId, recordType }: RecordActionContext) {
    console.log('Contact form action triggered for record:', recordId, 'type:', recordType)

    // Open a dialog with the contact form
    await showDialog({
      title: 'Contact Form',
      size: 'large',
      Dialog: (({ hideDialog }) => {
        // This is a strongly-typed Dialog component.
        // It can only use approved SDK components.
        return <ContactFormDialog hideDialog={hideDialog} />
      }) as DialogComponent,
    })
  },
}

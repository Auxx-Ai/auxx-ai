// apps/web/src/components/mail/email-editor/__examples__/preset-usage-examples.tsx
/**
 * Examples of how to use the preset values feature in ReplyComposeEditor and NewMessageDialog
 */
'use client'
import { Button } from '@auxx/ui/components/button'
import React from 'react'
import NewMessageDialog from '../new-message-dialog'
import type { EditorPresetValues } from '../types'

/**
 * Example 1: Preset TO recipient (Reply to Contact)
 */
export const PresetToRecipientExample = () => {
  const presetValues: EditorPresetValues = {
    to: [
      {
        id: 'contact-123',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        name: 'John Customer',
      },
    ],
  }

  return (
    <NewMessageDialog
      trigger={<Button>Email Contact</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 2: Preset multiple recipients with CC/BCC
 */
export const PresetMultipleRecipientsExample = () => {
  const presetValues: EditorPresetValues = {
    to: [
      {
        id: 'contact-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        name: 'John Customer',
      },
    ],
    cc: [
      {
        id: 'contact-2',
        identifier: 'manager@example.com',
        identifierType: 'EMAIL',
        name: 'Manager',
      },
    ],
    bcc: [
      {
        id: 'contact-3',
        identifier: 'tracking@example.com',
        identifierType: 'EMAIL',
        name: 'Support Tracker',
      },
    ],
  }

  return (
    <NewMessageDialog
      trigger={<Button>Email with CC/BCC</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 3: Preset subject and content (Template)
 */
export const PresetTemplateExample = () => {
  const presetValues: EditorPresetValues = {
    subject: 'Order Confirmation #12345',
    contentHtml: `
      <p>Dear Customer,</p>
      <p>Thank you for your order! Your order #12345 has been confirmed.</p>
      <p>You can track your order at: [tracking link]</p>
      <p>Best regards,<br>The Support Team</p>
    `,
  }

  return (
    <NewMessageDialog
      trigger={<Button>Use Template</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 4: Preset sender integration and signature
 */
export const PresetSenderExample = () => {
  const presetValues: EditorPresetValues = {
    integrationId: 'integration-support-email',
    signatureId: 'signature-professional',
    subject: 'Support Response',
  }

  return (
    <NewMessageDialog
      trigger={<Button>Reply from Support</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 5: Complete preset (all fields)
 */
export const CompletePresetExample = () => {
  const presetValues: EditorPresetValues = {
    to: [
      {
        id: 'contact-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        name: 'John Customer',
      },
    ],
    cc: [
      {
        id: 'contact-2',
        identifier: 'manager@example.com',
        identifierType: 'EMAIL',
        name: 'Manager',
      },
    ],
    subject: 'Re: Your inquiry about Product X',
    contentHtml: `
      <p>Hi John,</p>
      <p>Thank you for reaching out about Product X.</p>
      <p>Best regards</p>
    `,
    integrationId: 'integration-sales',
    signatureId: 'signature-sales-team',
  }

  return (
    <NewMessageDialog
      trigger={<Button>Complete Preset Example</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 6: Preset with attachments (must reference existing files)
 */
export const PresetWithAttachmentsExample = () => {
  const presetValues: EditorPresetValues = {
    to: [
      {
        id: 'contact-1',
        identifier: 'customer@example.com',
        identifierType: 'EMAIL',
        name: 'John Customer',
      },
    ],
    subject: 'Your requested documents',
    contentHtml: '<p>Please find the requested documents attached.</p>',
    attachments: [
      {
        id: 'file-123', // Must be an existing file ID
        name: 'invoice.pdf',
        size: 50000,
        mimeType: 'application/pdf',
        type: 'file',
      },
      {
        id: 'asset-456', // Must be an existing asset ID
        name: 'product-catalog.pdf',
        size: 120000,
        mimeType: 'application/pdf',
        type: 'asset',
      },
    ],
  }

  return (
    <NewMessageDialog
      trigger={<Button>Send with Attachments</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 7: Dynamic preset based on data
 */
export const DynamicPresetExample = ({
  contactEmail,
  contactName,
  orderId,
}: {
  contactEmail: string
  contactName: string
  orderId: string
}) => {
  const presetValues: EditorPresetValues = {
    to: [
      {
        id: `contact-${contactEmail}`,
        identifier: contactEmail,
        identifierType: 'EMAIL',
        name: contactName,
      },
    ],
    subject: `Order Update - ${orderId}`,
    contentHtml: `
      <p>Dear ${contactName},</p>
      <p>This is an update regarding your order ${orderId}.</p>
      <p>Best regards,<br>The Team</p>
    `,
  }

  return (
    <NewMessageDialog
      trigger={<Button>Send Order Update</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 8: Empty preset values (default behavior)
 */
export const NoPresetExample = () => {
  return (
    <NewMessageDialog
      trigger={<Button>Compose New</Button>}
      // No presetValues - uses default empty state
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

/**
 * Example 9: Partial preset (only some fields)
 */
export const PartialPresetExample = () => {
  const presetValues: EditorPresetValues = {
    // Only preset the subject, leave everything else empty
    subject: 'Quick question',
  }

  return (
    <NewMessageDialog
      trigger={<Button>Quick Question</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Message sent!')}
    />
  )
}

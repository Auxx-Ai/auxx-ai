// apps/web/src/components/mail/email-editor/__examples__/preset-usage-examples.tsx
/**
 * Examples of how to use the preset values feature with useCompose hook
 */
'use client'
import { Button } from '@auxx/ui/components/button'
import { useCompose } from '~/hooks/use-compose'
import type { EditorPresetValues } from '../types'

/**
 * Example 1: Preset TO recipient (Reply to Contact)
 */
export const PresetToRecipientExample = () => {
  const { openCompose } = useCompose()

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

  return <Button onClick={() => openCompose({ presetValues })}>Email Contact</Button>
}

/**
 * Example 2: Preset multiple recipients with CC/BCC
 */
export const PresetMultipleRecipientsExample = () => {
  const { openCompose } = useCompose()

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

  return <Button onClick={() => openCompose({ presetValues })}>Email with CC/BCC</Button>
}

/**
 * Example 3: Preset subject and content (Template)
 */
export const PresetTemplateExample = () => {
  const { openCompose } = useCompose()

  const presetValues: EditorPresetValues = {
    subject: 'Order Confirmation #12345',
    contentHtml: `
      <p>Dear Customer,</p>
      <p>Thank you for your order! Your order #12345 has been confirmed.</p>
      <p>You can track your order at: [tracking link]</p>
      <p>Best regards,<br>The Support Team</p>
    `,
  }

  return <Button onClick={() => openCompose({ presetValues })}>Use Template</Button>
}

/**
 * Example 4: Preset sender integration and signature
 */
export const PresetSenderExample = () => {
  const { openCompose } = useCompose()

  const presetValues: EditorPresetValues = {
    integrationId: 'integration-support-email',
    signatureId: 'signature-professional',
    subject: 'Support Response',
  }

  return <Button onClick={() => openCompose({ presetValues })}>Reply from Support</Button>
}

/**
 * Example 5: Complete preset (all fields)
 */
export const CompletePresetExample = () => {
  const { openCompose } = useCompose()

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

  return <Button onClick={() => openCompose({ presetValues })}>Complete Preset Example</Button>
}

/**
 * Example 6: Preset with attachments (must reference existing files)
 */
export const PresetWithAttachmentsExample = () => {
  const { openCompose } = useCompose()

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
        id: 'file-123',
        name: 'invoice.pdf',
        size: 50000,
        mimeType: 'application/pdf',
        type: 'file',
      },
      {
        id: 'asset-456',
        name: 'product-catalog.pdf',
        size: 120000,
        mimeType: 'application/pdf',
        type: 'asset',
      },
    ],
  }

  return <Button onClick={() => openCompose({ presetValues })}>Send with Attachments</Button>
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
  const { openCompose } = useCompose()

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

  return <Button onClick={() => openCompose({ presetValues })}>Send Order Update</Button>
}

/**
 * Example 8: Empty preset values (default behavior)
 */
export const NoPresetExample = () => {
  const { openCompose } = useCompose()

  return <Button onClick={() => openCompose()}>Compose New</Button>
}

/**
 * Example 9: Partial preset (only some fields)
 */
export const PartialPresetExample = () => {
  const { openCompose } = useCompose()

  const presetValues: EditorPresetValues = {
    subject: 'Quick question',
  }

  return <Button onClick={() => openCompose({ presetValues })}>Quick Question</Button>
}

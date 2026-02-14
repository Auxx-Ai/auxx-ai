import { Container, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface BillingEmailProps {
  name: string
  invoiceNumber: string
  amount: string
  dueDate: string
  invoiceUrl?: string
}

export async function BillingEmail({
  name,
  invoiceNumber,
  amount,
  dueDate,
  invoiceUrl,
}: BillingEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Billing Notification</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>This is a billing notification for your account.</Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
            Invoice Number: {invoiceNumber}
          </Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Amount Due: {amount}</Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Due Date: {dueDate}</Text>
        </div>

        {invoiceUrl && <EmailButton href={invoiceUrl} label='View Invoice' />}

        <Text>Please ensure payment is made by the due date.</Text>

        <Text className='mb-0'>
          If you have any questions about this invoice, please contact our billing team.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function BillingText({
  name,
  invoiceNumber,
  amount,
  dueDate,
  invoiceUrl,
}: BillingEmailProps): string {
  return `
Billing Notification

Hello ${name},

This is a billing notification for your account.

Invoice Number: ${invoiceNumber}
Amount Due: ${amount}
Due Date: ${dueDate}
${invoiceUrl ? `View Invoice: ${invoiceUrl}` : ''}

Please ensure payment is made by the due date.

If you have any questions about this invoice, please contact our billing team.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default BillingEmail

// Preview props for React Email dev server
BillingEmail.PreviewProps = {
  name: 'John Doe',
  invoiceNumber: 'INV-2024-001',
  amount: '$29.99',
  dueDate: 'March 15, 2024',
  invoiceUrl: 'https://app.auxx.ai/invoices/inv-2024-001',
}

// packages/email/src/templates/billing/payment-failed-email.tsx
import { Container, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading, EmailP } from '../../components/email-text'

interface PaymentFailedEmailProps {
  name: string
  planName: string
  amount: string
  nextRetryDate?: string
  billingPortalUrl?: string
}

export async function PaymentFailedEmail({
  name,
  planName,
  amount,
  nextRetryDate,
  billingPortalUrl = 'https://app.auxx.ai/settings/plans',
}: PaymentFailedEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Payment Failed for Your {planName} Subscription</EmailHeading>
        <Text>Hello {name},</Text>
        <EmailP>
          We were unable to process your payment of <strong>{amount}</strong> for your{' '}
          <strong>{planName}</strong> subscription.
        </EmailP>

        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '10px 10px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0px 0 8px 0', fontWeight: 'bold', color: '#dc2626' }}>
            Action Required
          </Text>
          <Text style={{ margin: '8px 0' }}>Plan: {planName}</Text>
          <Text style={{ margin: '8px 0' }}>Amount Due: {amount}</Text>
          {nextRetryDate && (
            <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
              We'll automatically retry the payment on {nextRetryDate}. To avoid service
              interruption, please update your payment method.
            </Text>
          )}
        </div>

        <Text>
          <strong>Why did this happen?</strong>
        </Text>
        <Text>Common reasons include:</Text>
        <ul>
          <li>Insufficient funds</li>
          <li>Expired card</li>
          <li>Card issuer declined the transaction</li>
          <li>Incorrect billing information</li>
        </ul>

        <Text>Please update your payment information to continue using your subscription:</Text>

        <EmailButton href={billingPortalUrl} label="Update Payment Method" />

        <Text style={{ fontSize: '14px', color: '#64748b' }}>
          If this payment fails multiple times, your subscription may be canceled automatically.
          Please contact your card issuer or update your payment method as soon as possible.
        </Text>

        <Text>Need help? Contact our support team and we'll be happy to assist you.</Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function PaymentFailedText({
  name,
  planName,
  amount,
  nextRetryDate,
  billingPortalUrl = 'https://app.auxx.ai/settings/plans',
}: PaymentFailedEmailProps): string {
  return `
Payment Failed for Your ${planName} Subscription

Hello ${name},

We were unable to process your payment of ${amount} for your ${planName} subscription.

ACTION REQUIRED
Plan: ${planName}
Amount Due: ${amount}
${nextRetryDate ? `Next Retry: ${nextRetryDate}` : ''}

Why did this happen?
Common reasons include:
- Insufficient funds
- Expired card
- Card issuer declined the transaction
- Incorrect billing information

Please update your payment information to continue using your subscription:

${billingPortalUrl}

If this payment fails multiple times, your subscription may be canceled automatically. Please contact your card issuer or update your payment method as soon as possible.

Need help? Contact our support team and we'll be happy to assist you.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default PaymentFailedEmail

PaymentFailedEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  amount: '$49.00',
  nextRetryDate: 'January 15, 2025',
  billingPortalUrl: 'https://app.auxx.ai/settings/plans',
}

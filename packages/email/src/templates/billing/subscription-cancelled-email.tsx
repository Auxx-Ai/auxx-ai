// packages/email/src/templates/billing/subscription-cancelled-email.tsx
import { Container, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface SubscriptionCancelledEmailProps {
  name: string
  planName: string
  endDate: string
  reactivateUrl?: string
}

export async function SubscriptionCancelledEmail({
  name,
  planName,
  endDate,
  reactivateUrl = 'https://app.auxx.ai/settings/plans',
}: SubscriptionCancelledEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Subscription Cancelled</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          We're sorry to see you go. Your <strong>{planName}</strong> subscription has been
          cancelled.
        </Text>

        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Plan: {planName}</Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Access Until: {endDate}</Text>
          <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
            You'll continue to have access to all {planName} features until {endDate}.
          </Text>
        </div>

        <Text>Changed your mind? You can reactivate your subscription at any time:</Text>

        <EmailButton href={reactivateUrl} label="Reactivate Subscription" />

        <Text>
          We'd love to hear your feedback. If there's anything we could do better, please let us
          know.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function SubscriptionCancelledText({
  name,
  planName,
  endDate,
  reactivateUrl = 'https://app.auxx.ai/settings/plans',
}: SubscriptionCancelledEmailProps): string {
  return `
Subscription Cancelled

Hello ${name},

We're sorry to see you go. Your ${planName} subscription has been cancelled.

Plan: ${planName}
Access Until: ${endDate}

You'll continue to have access to all ${planName} features until ${endDate}.

Changed your mind? You can reactivate your subscription at any time:

${reactivateUrl}

We'd love to hear your feedback. If there's anything we could do better, please let us know.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default SubscriptionCancelledEmail

SubscriptionCancelledEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  endDate: 'March 31, 2024',
  reactivateUrl: 'https://app.auxx.ai/settings/plans',
}

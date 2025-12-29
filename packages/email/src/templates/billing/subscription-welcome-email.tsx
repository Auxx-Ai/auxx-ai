// packages/email/src/templates/billing/subscription-welcome-email.tsx
import { Container, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface SubscriptionWelcomeEmailProps {
  name: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  dashboardUrl?: string
}

export async function SubscriptionWelcomeEmail({
  name,
  planName,
  billingCycle,
  dashboardUrl = 'https://app.auxx.ai/dashboard',
}: SubscriptionWelcomeEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Welcome to {planName}!</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Thank you for subscribing to the <strong>{planName}</strong> plan! Your subscription is
          now active.
        </Text>

        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Plan: {planName}</Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
            Billing Cycle: {billingCycle === 'ANNUAL' ? 'Annual' : 'Monthly'}
          </Text>
        </div>

        <Text>
          You now have access to all {planName} features. Get started by exploring your dashboard:
        </Text>

        <EmailButton href={dashboardUrl} label="Go to Dashboard" />

        <Text>
          If you have any questions or need help getting started, our support team is here to assist
          you.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function SubscriptionWelcomeText({
  name,
  planName,
  billingCycle,
  dashboardUrl = 'https://app.auxx.ai/dashboard',
}: SubscriptionWelcomeEmailProps): string {
  return `
Welcome to ${planName}!

Hello ${name},

Thank you for subscribing to the ${planName} plan! Your subscription is now active.

Plan: ${planName}
Billing Cycle: ${billingCycle === 'ANNUAL' ? 'Annual' : 'Monthly'}

You now have access to all ${planName} features. Get started by exploring your dashboard:

${dashboardUrl}

If you have any questions or need help getting started, our support team is here to assist you.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default SubscriptionWelcomeEmail

SubscriptionWelcomeEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  billingCycle: 'MONTHLY' as const,
  dashboardUrl: 'https://app.auxx.ai/dashboard',
}

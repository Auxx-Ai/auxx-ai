// packages/email/src/templates/billing/trial-ending-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface TrialEndingEmailProps {
  name: string
  planName: string
  daysRemaining: number
  billingUrl?: string
}

export async function TrialEndingEmail({
  name,
  planName,
  daysRemaining,
  billingUrl = `${WEBAPP_URL}/settings/plans`,
}: TrialEndingEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Trial is Ending Soon</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Your <strong>{planName}</strong> trial will end in{' '}
          <strong>
            {daysRemaining} day{daysRemaining !== 1 ? 's' : ''}
          </strong>
          .
        </Text>

        <div
          style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Plan: {planName}</Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
            Days Remaining: {daysRemaining}
          </Text>
          <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
            After your trial ends, your subscription will automatically continue at the regular
            price.
          </Text>
        </div>

        <Text>
          Want to continue enjoying {planName}? No action needed - your subscription will
          automatically activate.
        </Text>

        <Text>If you'd like to review your plan or make changes, visit your billing settings:</Text>

        <EmailButton href={billingUrl} label='Manage Subscription' />

        <Text>
          Questions? Our support team is available to help you make the most of {planName}.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function TrialEndingText({
  name,
  planName,
  daysRemaining,
  billingUrl = `${WEBAPP_URL}/settings/plans`,
}: TrialEndingEmailProps): string {
  return `
Your Trial is Ending Soon

Hello ${name},

Your ${planName} trial will end in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}.

Plan: ${planName}
Days Remaining: ${daysRemaining}

After your trial ends, your subscription will automatically continue at the regular price.

Want to continue enjoying ${planName}? No action needed - your subscription will automatically activate.

If you'd like to review your plan or make changes, visit your billing settings:

${billingUrl}

Questions? Our support team is available to help you make the most of ${planName}.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default TrialEndingEmail

TrialEndingEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  daysRemaining: 3,
  billingUrl: 'https://app.auxx.ai/settings/plans',
}

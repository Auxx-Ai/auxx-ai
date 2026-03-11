// packages/email/src/templates/billing/trial-started-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface TrialStartedEmailProps {
  name: string
  planName: string
  trialDays: number
  dashboardUrl?: string
}

export async function TrialStartedEmail({
  name,
  planName,
  trialDays,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
}: TrialStartedEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your {planName} Trial Has Started!</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Great news! Your <strong>{trialDays}-day free trial</strong> of the{' '}
          <strong>{planName}</strong> plan has started.
        </Text>

        <div
          style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #93c5fd',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Plan: {planName}</Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
            Trial Duration: {trialDays} days
          </Text>
          <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
            Your trial will automatically convert to a paid subscription after {trialDays} days
            unless you cancel.
          </Text>
        </div>

        <Text>Start exploring all the features of {planName} today:</Text>

        <EmailButton href={dashboardUrl} label='Get Started' />

        <Text>
          Make the most of your trial period! If you have any questions, our team is here to help.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function TrialStartedText({
  name,
  planName,
  trialDays,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
}: TrialStartedEmailProps): string {
  return `
Your ${planName} Trial Has Started!

Hello ${name},

Great news! Your ${trialDays}-day free trial of the ${planName} plan has started.

Plan: ${planName}
Trial Duration: ${trialDays} days

Your trial will automatically convert to a paid subscription after ${trialDays} days unless you cancel.

Start exploring all the features of ${planName} today:

${dashboardUrl}

Make the most of your trial period! If you have any questions, our team is here to help.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default TrialStartedEmail

TrialStartedEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  trialDays: 14,
  dashboardUrl: 'https://app.auxx.ai/dashboard',
}

// packages/email/src/templates/billing/trial-expired-email.tsx
import { Container, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface TrialExpiredEmailProps {
  name: string
  planName: string
  upgradeUrl?: string
}

export async function TrialExpiredEmail({
  name,
  planName,
  upgradeUrl = 'https://app.auxx.ai/settings/plans',
}: TrialExpiredEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your {planName} Trial Has Ended</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Your free trial of the <strong>{planName}</strong> plan has ended. We hope you enjoyed
          exploring all the features!
        </Text>

        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>Trial Ended</Text>
          <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
            Your account has been downgraded to the Free plan. To continue using {planName}{' '}
            features, please upgrade your subscription.
          </Text>
        </div>

        <Text>Ready to continue? Upgrade now to unlock all premium features:</Text>

        <EmailButton href={upgradeUrl} label='Upgrade to {planName}' />

        <Text>
          If you have any questions or need help choosing the right plan, our team is here to assist
          you.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function TrialExpiredText({
  name,
  planName,
  upgradeUrl = 'https://app.auxx.ai/settings/plans',
}: TrialExpiredEmailProps): string {
  return `
Your ${planName} Trial Has Ended

Hello ${name},

Your free trial of the ${planName} plan has ended. We hope you enjoyed exploring all the features!

Your account has been downgraded to the Free plan. To continue using ${planName} features, please upgrade your subscription.

Ready to continue? Upgrade now to unlock all premium features:

${upgradeUrl}

If you have any questions or need help choosing the right plan, our team is here to assist you.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default TrialExpiredEmail

TrialExpiredEmail.PreviewProps = {
  name: 'John Doe',
  planName: 'Growth',
  upgradeUrl: 'https://app.auxx.ai/settings/plans',
}

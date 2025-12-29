// packages/email/src/templates/lifecycle/trial-deletion-warning-email.tsx
import { Container, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface TrialDeletionWarningEmailProps {
  organizationName: string
  daysUntilDeletion: number
  reactivationLink: string
}

export async function TrialDeletionWarningEmail({
  organizationName,
  daysUntilDeletion,
  reactivationLink,
}: TrialDeletionWarningEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <div
          style={{
            border: '1px solid #ed8936',
            borderRadius: '8px',
            padding: '10px 10px 5px 10px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0', fontWeight: 'bold', fontSize: '18px', color: '#c05621' }}>
            ⚠️ Account Deletion Notice
          </Text>
          <Text style={{ margin: '8px 0', fontWeight: '600', fontSize: '16px', color: '#744210' }}>
            Your trial has ended and your account is scheduled for deletion in {daysUntilDeletion}{' '}
            days.
          </Text>
        </div>

        <EmailHeading>Your Auxx.ai Trial Has Ended</EmailHeading>

        <Text>Hi there,</Text>

        <Text>
          Your Auxx.ai trial for <strong>{organizationName}</strong> ended more than a week ago. To
          keep our systems efficient and secure, we'll be permanently deleting your account in{' '}
          <strong>{daysUntilDeletion} days</strong> unless you take action.
        </Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '25px 0',
          }}>
          <Text style={{ margin: '0 0 15px 0', fontWeight: 'bold', color: '#2d3748' }}>
            What this means:
          </Text>
          <ul style={{ margin: '0', paddingLeft: '20px', color: '#4a5568' }}>
            <li style={{ marginBottom: '8px' }}>All your data will be permanently deleted</li>
            <li style={{ marginBottom: '8px' }}>Your email integrations will be disconnected</li>
            <li style={{ marginBottom: '8px' }}>Your team members will lose access</li>
            <li style={{ marginBottom: '8px' }}>This action cannot be undone</li>
          </ul>
        </div>

        <div style={{ textAlign: 'center', margin: '35px 0' }}>
          <EmailButton href={reactivationLink} label="Reactivate My Account" />
        </div>

        <Text style={{ fontSize: '14px', color: '#4a5568' }}>
          Don't want to upgrade right now? You can also export your data before deletion.
        </Text>

        <Text style={{ fontSize: '14px', color: '#718096', marginTop: '24px' }}>
          Questions? Reply to this email or contact us at support@auxx.ai
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function TrialDeletionWarningText({
  organizationName,
  daysUntilDeletion,
  reactivationLink,
}: TrialDeletionWarningEmailProps): string {
  return `
ACCOUNT DELETION NOTICE

Hi there,

Your Auxx.ai trial for "${organizationName}" ended more than a week ago. To keep our systems efficient and secure, we'll be permanently deleting your account in ${daysUntilDeletion} days unless you take action.

What this means:
• All your data will be permanently deleted
• Your email integrations will be disconnected  
• Your team members will lose access
• This action cannot be undone

REACTIVATE YOUR ACCOUNT:
${reactivationLink}

Don't want to upgrade right now? You can also export your data before deletion.

Questions? Reply to this email or contact us at support@auxx.ai

Best regards,
The Auxx.ai Team
  `.trim()
}

export default TrialDeletionWarningEmail

// Preview props for React Email dev server
TrialDeletionWarningEmail.PreviewProps = {
  organizationName: 'Acme Store',
  daysUntilDeletion: 7,
  reactivationLink: 'https://app.auxx.ai/reactivate?org=123',
}

// packages/email/src/templates/lifecycle/trial-deletion-final-email.tsx
import { Container, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface TrialDeletionFinalEmailProps {
  organizationName: string
  hoursUntilDeletion: number
  reactivationLink: string
}

export async function TrialDeletionFinalEmail({
  organizationName,
  hoursUntilDeletion,
  reactivationLink,
}: TrialDeletionFinalEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>URGENT: Your Account Will Be Deleted Soon</EmailHeading>

        <Text>Hi there,</Text>

        <Text>
          This is your <strong>final notice</strong>. Your Auxx.ai account for{' '}
          <strong>{organizationName}</strong> will be permanently deleted in{' '}
          <strong>{hoursUntilDeletion} hours</strong>.
        </Text>

        <div
          style={{
            backgroundColor: '#ffe2e2',
            border: '1px solid #e7000b',
            borderRadius: '8px',
            padding: '10px 10px 5px 10px',
            margin: '15px 0 25px 0',
          }}>
          <Text style={{ margin: '0 0 5px 0', fontWeight: 'bold', color: '#e7000b' }}>
            Last chance to save your account
          </Text>
          <Text style={{ margin: '0', fontWeight: '500' }}>
            After deletion, all your data will be permanently removed and cannot be recovered. This
            includes all tickets, conversations, integrations, and team data.
          </Text>
        </div>

        <div style={{ textAlign: 'center', margin: '35px 0' }}>
          <EmailButton
            href={reactivationLink}
            label="REACTIVATE NOW"
            style={{
              backgroundColor: '#e53e3e',
              fontSize: '18px',
              fontWeight: '700',
              textTransform: 'uppercase',
              padding: '18px 35px',
            }}
          />
        </div>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '25px 0',
          }}>
          <Text style={{ margin: '0 0 5px 0', fontWeight: 'bold', color: '#2d3748' }}>
            What will be deleted:
          </Text>
          <ul style={{ margin: '0', paddingLeft: '20px', color: '#4a5568' }}>
            <li style={{ marginBottom: '8px' }}>All support tickets and conversations</li>
            <li style={{ marginBottom: '8px' }}>Email integrations (Gmail, Outlook)</li>
            <li style={{ marginBottom: '8px' }}>Team members and their access</li>
            <li style={{ marginBottom: '8px' }}>All uploaded files and attachments</li>
            <li style={{ marginBottom: '8px' }}>Custom rules and automation</li>
            <li style={{ marginBottom: '8px' }}>Analytics and reporting data</li>
          </ul>
        </div>

        <Text style={{ fontSize: '16px', color: '#e53e3e', fontWeight: '600', marginTop: '24px' }}>
          Need immediate help? Contact support at{' '}
          <a href="mailto:support@auxx.ai" style={{ color: '#e53e3e', textDecoration: 'none' }}>
            support@auxx.ai
          </a>{' '}
          right away.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function TrialDeletionFinalText({
  organizationName,
  hoursUntilDeletion,
  reactivationLink,
}: TrialDeletionFinalEmailProps): string {
  return `
🚨 URGENT: FINAL NOTICE 🚨

Hi there,

This is your FINAL NOTICE. Your Auxx.ai account for "${organizationName}" will be permanently deleted in ${hoursUntilDeletion} hours.

⏰ LAST CHANCE TO SAVE YOUR ACCOUNT
After deletion, all your data will be permanently removed and cannot be recovered.

REACTIVATE NOW - LAST CHANCE:
${reactivationLink}

What will be deleted:
• All support tickets and conversations
• Email integrations (Gmail, Outlook)
• Team members and their access  
• All uploaded files and attachments
• Custom rules and automation
• Analytics and reporting data

Need immediate help? Contact support at support@auxx.ai right away.

The Auxx.ai Team
  `.trim()
}

export default TrialDeletionFinalEmail

// Preview props for React Email dev server
TrialDeletionFinalEmail.PreviewProps = {
  organizationName: 'Acme Store',
  hoursUntilDeletion: 24,
  reactivationLink: 'https://app.auxx.ai/reactivate?org=123',
}

import { Container, Heading, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface EmailChangeVerificationEmailProps {
  name: string
  newEmail: string
  verificationLink: string
  supportEmail?: string
}

export async function EmailChangeVerificationEmail({
  name,
  newEmail,
  verificationLink,
  supportEmail = 'support@auxx.ai',
}: EmailChangeVerificationEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Email Address Change Request</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>You've requested to change your email address to:</Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            padding: '15px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0', color: '#2d3748', fontSize: '16px', fontWeight: 'bold' }}>
            {newEmail}
          </Text>
        </div>

        <Text>To confirm this change, please click the button below:</Text>

        <EmailButton href={verificationLink} label="Confirm Email Change" />

        <Text style={{ fontSize: '14px', color: '#718096' }}>
          Or copy and paste this link into your browser:
        </Text>
        <Text style={{ fontSize: '13px', color: '#4299e1', wordBreak: 'break-all' }}>
          {verificationLink}
        </Text>

        {/* Security Notice */}
        <div
          style={{
            backgroundColor: '#fff5f5',
            border: '1px solid #feb2b2',
            borderRadius: '6px',
            padding: '15px',
            margin: '25px 0',
          }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <span style={{ color: '#e53e3e', fontSize: '20px', marginRight: '10px' }}>⚠️</span>
            <div>
              <Text style={{ margin: '0 0 8px 0', color: '#c53030', fontWeight: 'bold' }}>
                Security Notice
              </Text>
              <Text style={{ margin: '0 0 8px 0', color: '#742a2a', fontSize: '14px' }}>
                Once confirmed, you'll need to use your new email address to sign in to your
                account. Your current email address will no longer have access.
              </Text>
              <Text style={{ margin: '0', color: '#742a2a', fontSize: '14px' }}>
                <strong>If you didn't request this change</strong>, please contact our support team
                immediately at {supportEmail}
              </Text>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div
          style={{
            marginTop: '30px',
            paddingTop: '20px',
            borderTop: '1px solid #e2e8f0',
          }}>
          <Text
            style={{
              fontSize: '14px',
              color: '#718096',
              margin: '0 0 10px 0',
              fontWeight: 'bold',
            }}>
            Important:
          </Text>
          <Text style={{ fontSize: '14px', color: '#718096', margin: '0' }}>
            • This verification link will expire in 24 hours
            <br />
            • After confirmation, all future emails will be sent to your new address
            <br />• You may need to update your email in any connected services
          </Text>
        </div>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function EmailChangeVerificationText({
  name,
  newEmail,
  verificationLink,
  supportEmail = 'support@auxx.ai',
}: EmailChangeVerificationEmailProps): string {
  return `
Email Address Change Request

Hello ${name},

You've requested to change your email address to:
${newEmail}

To confirm this change, please click the link below:
${verificationLink}

SECURITY NOTICE
---------------
Once confirmed, you'll need to use your new email address to sign in to your account.
Your current email address will no longer have access.

If you didn't request this change, please contact our support team immediately at ${supportEmail}

IMPORTANT INFORMATION
--------------------
• This verification link will expire in 24 hours
• After confirmation, all future emails will be sent to your new address
• You may need to update your email in any connected services

--
Best regards,
The Auxx.ai Team

Need help? Contact us at ${supportEmail}
  `.trim()
}

export default EmailChangeVerificationEmail

// Preview props for React Email dev server
EmailChangeVerificationEmail.PreviewProps = {
  name: 'John Doe',
  newEmail: 'john.doe.new@example.com',
  verificationLink: 'https://app.auxx.ai/verify-email-change/abc123def456',
  supportEmail: 'support@auxx.ai',
}

// packages/email/src/templates/invite/developer-invite-email.tsx

import { Container, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface DeveloperInviteEmailProps {
  inviterName: string
  accountName: string
  acceptLink: string
  role: string
}

export async function DeveloperInviteEmail({
  inviterName,
  accountName,
  acceptLink,
  role,
}: DeveloperInviteEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Join {accountName}</EmailHeading>
        <Text>Hello,</Text>
        <Text>
          {inviterName} has invited you to join <strong>{accountName}</strong> on the Auxx.ai
          Developer Portal as a <strong>{role}</strong>.
        </Text>
        <Text>Click the button below to accept the invitation:</Text>

        <EmailButton href={acceptLink} label='Accept Invitation' />

        <Text className='mb-0'>
          If you were not expecting this invitation, you can safely ignore this email.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

export function DeveloperInviteText({
  inviterName,
  accountName,
  acceptLink,
  role,
}: DeveloperInviteEmailProps): string {
  return `
Join ${accountName}

Hello,

${inviterName} has invited you to join ${accountName} on the Auxx.ai Developer Portal as a ${role}.

Click the link below to accept the invitation:
${acceptLink}

If you were not expecting this invitation, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default DeveloperInviteEmail

DeveloperInviteEmail.PreviewProps = {
  inviterName: 'Jane Smith',
  accountName: 'Acme Developer Account',
  acceptLink: 'https://build.auxx.ai/invitations/accept?token=abc123def456',
  role: 'member',
}

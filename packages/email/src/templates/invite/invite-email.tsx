import { Container, Heading, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface InviteEmailProps {
  inviterName: string
  organizationName: string
  acceptLink: string
  role: string
}

export async function InviteEmail({
  inviterName,
  organizationName,
  acceptLink,
  role,
}: InviteEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Join {organizationName}</EmailHeading>
        <Text>Hello,</Text>
        <Text>
          {inviterName} has invited you to join the <strong>{organizationName}</strong> organization
          on Auxx.ai as a <strong>{role}</strong>.
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

// Text version
export function InviteText({
  inviterName,
  organizationName,
  acceptLink,
  role,
}: InviteEmailProps): string {
  return `
Join ${organizationName}

Hello,

${inviterName} has invited you to join the ${organizationName} organization on Auxx.ai as a ${role}.

Click the link below to accept the invitation:
${acceptLink}

If you were not expecting this invitation, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default InviteEmail

// Preview props for React Email dev server
InviteEmail.PreviewProps = {
  inviterName: 'Jane Smith',
  organizationName: 'Acme Corporation',
  acceptLink: 'https://app.auxx.ai/invitations/accept/abc123def456',
  role: 'member',
}

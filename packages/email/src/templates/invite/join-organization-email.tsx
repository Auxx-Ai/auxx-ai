import { Container, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface JoinOrganizationEmailProps {
  inviterName: string
  organizationName: string
  acceptLink: string
  role: string
  invitedUserName?: string
}

export async function JoinOrganizationEmail({
  inviterName,
  organizationName,
  acceptLink,
  role,
  invitedUserName,
}: JoinOrganizationEmailProps): Promise<React.JSX.Element> {
  const greeting = invitedUserName ? `Hello ${invitedUserName},` : 'Hello,'

  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Join {organizationName}</EmailHeading>
        <Text>{greeting}</Text>
        <Text>
          {inviterName} has invited you to join the <strong>{organizationName}</strong> organization
          on Auxx.ai as a <strong>{role}</strong>.
        </Text>
        <Text>
          Since you already have an account, simply click the button below to accept the invitation:
        </Text>

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
export function JoinOrganizationText({
  inviterName,
  organizationName,
  acceptLink,
  role,
  invitedUserName,
}: JoinOrganizationEmailProps): string {
  const greeting = invitedUserName ? `Hello ${invitedUserName},` : 'Hello,'

  return `
Join ${organizationName}

${greeting}

${inviterName} has invited you to join the ${organizationName} organization on Auxx.ai as a ${role}.

Since you already have an account, simply click the link below to accept the invitation:
${acceptLink}

If you were not expecting this invitation, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default JoinOrganizationEmail

// Preview props for React Email dev server
JoinOrganizationEmail.PreviewProps = {
  inviterName: 'Jane Smith',
  organizationName: 'Acme Corporation',
  acceptLink: 'https://app.auxx.ai/invitations/accept/abc123def456',
  role: 'admin',
  invitedUserName: 'John Doe',
}

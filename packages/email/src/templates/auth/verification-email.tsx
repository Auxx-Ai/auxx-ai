import { Container, Heading, Text } from '@react-email/components'
import React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface VerificationEmailProps {
  name: string
  verificationLink: string
}

export async function VerificationEmail({
  name,
  verificationLink,
}: VerificationEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Email Verification</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Thank you for signing up. Please verify your email address by clicking the link below:
        </Text>

        <EmailButton href={verificationLink} label="Verify Email Address" />

        <Text className="mb-0">
          If you didn't sign up for an account, you can safely ignore this email.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VerificationText({ name, verificationLink }: VerificationEmailProps): string {
  return `
Email Verification

Hello ${name},

Thank you for signing up. Please verify your email address by clicking the link below:

${verificationLink}

If you didn't sign up for an account, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VerificationEmail

// Preview props for React Email dev server
VerificationEmail.PreviewProps = {
  name: 'John Doe',
  verificationLink: 'https://app.auxx.ai/verify/abc123def456',
}

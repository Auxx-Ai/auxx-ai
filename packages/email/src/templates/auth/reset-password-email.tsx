import { Container, Heading, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface ResetPasswordEmailProps {
  name: string
  resetLink: string
}

export async function ResetPasswordEmail({
  name,
  resetLink,
}: ResetPasswordEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Password Reset Request</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          We received a request to reset your password. Click the link below to create a new
          password:
        </Text>

        <EmailButton href={resetLink} label='Reset Password' />

        <Text className='font-bold'>This link is valid for 24 hours.</Text>

        <Text className='mb-0'>
          If you didn't request a password reset, you can safely ignore this email.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function ResetPasswordText({ name, resetLink }: ResetPasswordEmailProps): string {
  return `
Password Reset Request

Hello ${name},

We received a request to reset your password. Click the link below to create a new password:

${resetLink}

This link is valid for 24 hours.

If you didn't request a password reset, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default ResetPasswordEmail

// Preview props for React Email dev server
ResetPasswordEmail.PreviewProps = {
  name: 'John Doe',
  resetLink: 'https://app.auxx.ai/reset-password/abc123def456',
}

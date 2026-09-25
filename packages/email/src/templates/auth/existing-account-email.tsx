// packages/email/src/templates/auth/existing-account-email.tsx

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface ExistingAccountEmailProps {
  name?: string
  loginLink: string
  resetPasswordLink: string
}

/** Sent when someone signs up with an email that already has an account. */
export async function ExistingAccountEmail({
  name = 'there',
  loginLink,
  resetPasswordLink,
}: ExistingAccountEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>You already have an account</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Someone tried to sign up for Auxx.ai with this email address, but an account already
          exists for it. You can sign in instead:
        </Text>

        <EmailButton href={loginLink} label='Sign In' />

        <Text>
          Forgot your password? <a href={resetPasswordLink}>Reset it here</a>.
        </Text>

        <Text className='mb-0'>If this wasn't you, you can safely ignore this email.</Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function ExistingAccountText({
  name = 'there',
  loginLink,
  resetPasswordLink,
}: ExistingAccountEmailProps): string {
  return `
You already have an account

Hi ${name},

Someone tried to sign up for Auxx.ai with this email address, but an account already exists for it. You can sign in instead:

${loginLink}

Forgot your password? Reset it here: ${resetPasswordLink}

If this wasn't you, you can safely ignore this email.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default ExistingAccountEmail

// Preview props for React Email dev server
ExistingAccountEmail.PreviewProps = {
  name: 'John Doe',
  loginLink: 'https://app.auxx.ai/login',
  resetPasswordLink: 'https://app.auxx.ai/forgot-password',
}

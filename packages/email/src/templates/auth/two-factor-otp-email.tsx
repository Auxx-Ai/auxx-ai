// packages/email/src/templates/auth/two-factor-otp-email.tsx

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface TwoFactorOtpEmailProps {
  name?: string
  otp: string
}

export async function TwoFactorOtpEmail({
  name = 'there',
  otp,
}: TwoFactorOtpEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your verification code</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>Use the code below to finish signing in to your Auxx.ai account.</Text>
        <Text className='my-6 text-center font-bold text-3xl tracking-[0.3em]'>{otp}</Text>
        <Text>This code expires shortly and can only be used once.</Text>
        <Text className='mb-0 font-bold'>
          If you did not try to sign in, someone may have your password — change it right away.
        </Text>
        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function TwoFactorOtpText({ name = 'there', otp }: TwoFactorOtpEmailProps): string {
  return `
Your verification code

Hi ${name},

Use the code below to finish signing in to your Auxx.ai account.

${otp}

This code expires shortly and can only be used once.

If you did not try to sign in, someone may have your password — change it right away.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default TwoFactorOtpEmail

// Preview props for React Email dev server
TwoFactorOtpEmail.PreviewProps = {
  name: 'John Doe',
  otp: '123456',
}

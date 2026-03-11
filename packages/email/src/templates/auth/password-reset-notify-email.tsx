import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface PasswordResetNotifyEmailProps {
  name?: string
}

export async function PasswordResetNotifyEmail({
  name = 'there',
}: PasswordResetNotifyEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Password Changed Successfully</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Your password has been successfully changed. If you made this change, no further action is
          required.
        </Text>
        <Text className='font-bold'>
          If you did not make this change, please contact our support team immediately.
        </Text>
        <Text className='mb-0'>
          For your security, we recommend using a strong, unique password for your account.
        </Text>
        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}
// Text version
export function PasswordResetNotifyText({ name = 'there' }: PasswordResetNotifyEmailProps): string {
  return `
Password Changed Successfully

Hi ${name},

Your password has been successfully changed. If you made this change, no further action is required.

If you did not make this change, please contact our support team immediately.

For your security, we recommend using a strong, unique password for your account.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default PasswordResetNotifyEmail

// Preview props for React Email dev server
PasswordResetNotifyEmail.PreviewProps = {
  name: 'John Doe',
}

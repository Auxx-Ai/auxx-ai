import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface WelcomeEmailProps {
  name: string
  loginLink?: string
}

export async function WelcomeEmail({
  name,
  loginLink,
}: WelcomeEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Welcome to Auxx.ai!</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>Thank you for joining our platform. We're excited to have you on board!</Text>
        {loginLink && <EmailButton href={loginLink} label='Log in to your account' />}
        <Text className='mb-0'>
          If you have any questions or need assistance, please don't hesitate to contact our support
          team.
        </Text>
        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function WelcomeText({ name, loginLink }: WelcomeEmailProps): string {
  return `
Welcome to Auxx.ai!

Hello ${name},

Thank you for joining our platform. We're excited to have you on board!

${loginLink ? `Log in to your account: ${loginLink}` : ''}

If you have any questions or need assistance, please don't hesitate to contact our support team.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default WelcomeEmail

// Preview props for React Email dev server
WelcomeEmail.PreviewProps = {
  name: 'John Doe',
  loginLink: 'https://app.auxx.ai/login',
}

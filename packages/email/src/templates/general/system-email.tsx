import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface SystemEmailProps {
  name: string
  subject: string
  message: string
}

export async function SystemEmail({
  name,
  subject,
  message,
}: SystemEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>{subject}</EmailHeading>
        <Text>Hello {name},</Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0' }} dangerouslySetInnerHTML={{ __html: message }} />
        </div>

        <Text className='mb-0'>
          If you have any questions about this notification, please contact our support team.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function SystemText({ name, subject, message }: SystemEmailProps): string {
  // Strip HTML tags from message for text version
  const textMessage = message.replace(/<[^>]*>/g, '')

  return `
${subject}

Hello ${name},

${textMessage}

If you have any questions about this notification, please contact our support team.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default SystemEmail

// Preview props for React Email dev server
SystemEmail.PreviewProps = {
  name: 'John Doe',
  subject: 'System Maintenance Notification',
  message:
    'We will be performing scheduled maintenance on our servers tonight from 2:00 AM to 4:00 AM EST. During this time, you may experience brief service interruptions.',
}

import { Column, Container, Heading, Row, Section, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface ApprovalReminderEmailProps {
  toName: string
  workflowName: string
  message?: string
  approvalUrl: string
  reminderNumber: number
  timeRemaining: string
  expiresAt: string
}

export async function ApprovalReminderEmail({
  toName,
  workflowName,
  message,
  approvalUrl,
  reminderNumber,
  timeRemaining,
  expiresAt,
}: ApprovalReminderEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <EmailHeading>Reminder #{reminderNumber}</EmailHeading>
      <Text>Hi {toName},</Text>
      <Text style={{ margin: 0 }}>
        This is reminder #{reminderNumber} that your approval is still pending and will expire soon.
      </Text>
      <Text style={{ marginTop: 0 }}>Your approval is still required for the workflow:</Text>
      <Container className='px-10'>
        <Section
          style={{
            backgroundColor: '#edf2f7',
            border: '1px solid #fda085',
            borderLeft: '4px solid #fda085',
            borderRadius: '4px',
            padding: '15px',
          }}>
          <Text style={{ margin: 0, fontWeight: 'bold', fontSize: '18px' }}>{workflowName}</Text>
        </Section>
      </Container>

      {message && (
        <Section
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #cbd5e0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0 0 10px 0', fontWeight: 600 }}>📝 Original message:</Text>
          <Text style={{ margin: 0 }}>{message}</Text>
        </Section>
      )}

      <Text style={{ textAlign: 'center', margin: '25px 0 5px 0' }}>
        Please review and take action:
      </Text>

      <Section>
        <Row className='bg-gray-50 p-10 rounded-xl'>
          <Column className='text-center w-1/3'>
            <EmailButton
              href={`${approvalUrl}?action=approve`}
              label='Approve'
              className='bg-green-500'
            />
          </Column>
          <Column className='text-center w-1/3'>
            <Text style={{ margin: 0 }}>or</Text>
          </Column>
          <Column className='text-center w-1/3'>
            <EmailButton href={`${approvalUrl}?action=deny`} label='Deny' className='bg-red-500' />
          </Column>
        </Row>
      </Section>

      <Section
        style={{
          backgroundColor: '#fef5e7',
          border: '1px solid #f9c851',
          borderRadius: '8px',
          padding: '5px',
          margin: '30px 0',
          textAlign: 'center',
        }}>
        <Text style={{ margin: 0, color: '#c53030', fontSize: '16px', fontWeight: 'bold' }}>
          Expires at: {expiresAt}
        </Text>
        <Text style={{ margin: '0px 0 0 0', color: '#744210', fontSize: '14px' }}>
          Time remaining: {timeRemaining}
        </Text>
      </Section>

      <Text style={{ fontSize: '14px', color: '#718096', textAlign: 'center' }}>
        View details: {approvalUrl}
      </Text>

      <EmailFooter />
    </EmailTemplate>
  )
}

// Text version
export function ApprovalReminderText({
  toName,
  workflowName,
  message,
  approvalUrl,
  reminderNumber,
  timeRemaining,
  expiresAt,
}: ApprovalReminderEmailProps): string {
  return `
Reminder #${reminderNumber}: Approval Required - ${workflowName}

Hi ${toName},

⏰ ONLY ${timeRemaining.toUpperCase()} REMAINING!

This is reminder #${reminderNumber} that your approval is still required for the workflow:
"${workflowName}"

${message ? `Original message:\n${message}\n\n` : ''}TAKE ACTION NOW:
---------------
• Approve: ${approvalUrl}?action=approve
• Deny: ${approvalUrl}?action=deny

⏰ Expires at: ${expiresAt}
Time remaining: ${timeRemaining}

View details: ${approvalUrl}

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default ApprovalReminderEmail

// Preview props for React Email dev server
ApprovalReminderEmail.PreviewProps = {
  toName: 'John Doe',
  workflowName: 'Customer Support Workflow',
  message: 'Please review this customer support request and approve if appropriate.',
  approvalUrl: 'https://app.auxx.ai/approvals/abc123def456',
  reminderNumber: 2,
  timeRemaining: '4 hours',
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toLocaleString(), // 4 hours from now
}

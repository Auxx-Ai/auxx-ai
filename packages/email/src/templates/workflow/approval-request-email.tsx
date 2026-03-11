import { Column, Container, Row, Section, Text } from '@react-email/components'

import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface ApprovalRequestEmailProps {
  toName: string
  workflowName: string
  message?: string
  approvalUrl: string
  expiresAt: Date
}

export async function ApprovalRequestEmail({
  toName,
  workflowName,
  message,
  approvalUrl,
  expiresAt,
}: ApprovalRequestEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Approval Required</EmailHeading>

        <Text>Hi {toName},</Text>

        <Text>Your approval is required for the following workflow:</Text>

        <Section
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderLeft: '4px solid #667eea',
            borderRadius: '4px',
            padding: '15px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: 0, fontWeight: 'bold', fontSize: '18px' }}>{workflowName}</Text>
        </Section>

        {message && (
          <Section
            style={{
              backgroundColor: '#edf2f7',
              border: '1px solid #cbd5e0',
              borderRadius: '8px',
              padding: '20px',
              margin: '20px 0',
            }}>
            <Text style={{ margin: '0 0 10px 0', fontWeight: 600 }}>📝 Message from workflow:</Text>
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
              <EmailButton
                href={`${approvalUrl}?action=deny`}
                label='Deny'
                className='bg-red-500'
              />
            </Column>
          </Row>
        </Section>

        <Section
          style={{
            backgroundColor: '#fffaf0',
            border: '1px solid #feb2b2',
            borderRadius: '6px',
            padding: '5px',
            margin: '20px 0',
            textAlign: 'center',
          }}>
          <Text style={{ margin: 0, color: '#c53030', fontWeight: 'bold' }}>
            This approval expires at {expiresAt}
          </Text>
        </Section>

        <Text style={{ fontSize: '14px', color: '#718096', textAlign: 'center' }}>
          Or view details at: {approvalUrl}
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function ApprovalRequestText({
  toName,
  workflowName,
  message,
  approvalUrl,
  expiresAt,
}: ApprovalRequestEmailProps): string {
  return `
Approval Required: ${workflowName}

Hi ${toName},

Your approval is required for the workflow "${workflowName}".

${message ? `Message from workflow:\n${message}\n\n` : ''}Take action:
-----------
• Approve: ${approvalUrl}?action=approve
• Deny: ${approvalUrl}?action=deny

⏰ This approval expires at ${expiresAt}

Or view details at: ${approvalUrl}

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default ApprovalRequestEmail

// Preview props for React Email dev server
ApprovalRequestEmail.PreviewProps = {
  toName: 'John Doe',
  workflowName: 'Customer Support Workflow',
  message: 'Please review this customer support request and approve if appropriate.',
  approvalUrl: 'https://app.auxx.ai/approvals/abc123def456',
  expiresAt: new Date().toLocaleString(), //new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
}

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface VisitDispatchedEmailProps {
  name: string
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  timezone: string
  workOrderUrl: string
}

function formatWindow(startTime: string, endTime: string, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }
  const start = new Date(startTime).toLocaleString('en-US', opts)
  const end = new Date(endTime).toLocaleTimeString('en-US', {
    timeStyle: 'short',
    timeZone: timezone,
  })
  return `${start} – ${end} (${timezone})`
}

export async function VisitDispatchedEmail({
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: VisitDispatchedEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>You've Been Dispatched</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          You've been dispatched to {workOrderNumber ? `${workOrderNumber} — ` : ''}
          {workOrderTitle}.
        </Text>

        <div
          style={{
            backgroundColor: '#f7fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          {workOrderNumber && (
            <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
              Work Order: {workOrderNumber}
            </Text>
          )}
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>{workOrderTitle}</Text>
          <Text style={{ margin: '8px 0' }}>{formatWindow(startTime, endTime, timezone)}</Text>
        </div>

        <EmailButton href={workOrderUrl} label='View Work Order' />

        <Text className='mb-0'>
          If anything about the schedule has changed, check the job before you head out.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VisitDispatchedText({
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: VisitDispatchedEmailProps): string {
  return `
You've Been Dispatched

Hello ${name},

You've been dispatched to ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle}.

${workOrderNumber ? `Work Order: ${workOrderNumber}\n` : ''}${workOrderTitle}
${formatWindow(startTime, endTime, timezone)}

View Work Order: ${workOrderUrl}

If anything about the schedule has changed, check the job before you head out.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VisitDispatchedEmail

// Preview props for React Email dev server
VisitDispatchedEmail.PreviewProps = {
  name: 'Alex Rivera',
  workOrderNumber: 'WO-0042',
  workOrderTitle: 'Water heater replacement',
  startTime: '2026-07-14T15:00:00.000Z',
  endTime: '2026-07-14T17:00:00.000Z',
  timezone: 'America/Chicago',
  workOrderUrl: 'https://app.auxx.ai/app/work-orders/wo_0042',
}

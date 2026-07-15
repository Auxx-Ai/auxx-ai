// packages/email/src/templates/general/visit-canceled-email.tsx

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface VisitCanceledEmailProps {
  name: string
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  timezone: string
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

export async function VisitCanceledEmail({
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
}: VisitCanceledEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Visit Was Canceled</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          The visit for {workOrderNumber ? `${workOrderNumber} — ` : ''}
          {workOrderTitle} has been canceled.
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
          <Text style={{ margin: '8px 0', textDecoration: 'line-through', color: '#a0aec0' }}>
            {formatWindow(startTime, endTime, timezone)}
          </Text>
        </div>

        <Text className='mb-0'>Nothing to do for this visit — it's off your schedule.</Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VisitCanceledText({
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
}: VisitCanceledEmailProps): string {
  return `
Your Visit Was Canceled

Hello ${name},

The visit for ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle} has been canceled.

${workOrderNumber ? `Work Order: ${workOrderNumber}\n` : ''}${workOrderTitle}
${formatWindow(startTime, endTime, timezone)}

Nothing to do for this visit — it's off your schedule.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VisitCanceledEmail

// Preview props for React Email dev server
VisitCanceledEmail.PreviewProps = {
  name: 'Alex Rivera',
  workOrderNumber: 'WO-0042',
  workOrderTitle: 'Water heater replacement',
  startTime: '2026-07-14T15:00:00.000Z',
  endTime: '2026-07-14T17:00:00.000Z',
  timezone: 'America/Chicago',
}

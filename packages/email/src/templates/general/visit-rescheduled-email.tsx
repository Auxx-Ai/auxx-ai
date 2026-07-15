// packages/email/src/templates/general/visit-rescheduled-email.tsx

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface VisitRescheduledEmailProps {
  name: string
  workOrderNumber: string
  workOrderTitle: string
  oldStartTime: string
  oldEndTime: string
  newStartTime: string
  newEndTime: string
  timezone: string
  workOrderUrl: string
  address?: string
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

export async function VisitRescheduledEmail({
  name,
  workOrderNumber,
  workOrderTitle,
  oldStartTime,
  oldEndTime,
  newStartTime,
  newEndTime,
  timezone,
  workOrderUrl,
  address,
}: VisitRescheduledEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Visit Was Rescheduled</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          The visit for {workOrderNumber ? `${workOrderNumber} — ` : ''}
          {workOrderTitle} has been rescheduled.
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
          {address && <Text style={{ margin: '8px 0' }}>{address}</Text>}
          <Text style={{ margin: '8px 0', textDecoration: 'line-through', color: '#a0aec0' }}>
            Was: {formatWindow(oldStartTime, oldEndTime, timezone)}
          </Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold' }}>
            Now: {formatWindow(newStartTime, newEndTime, timezone)}
          </Text>
        </div>

        <EmailButton href={workOrderUrl} label='View Work Order' />

        <Text className='mb-0'>Update your plans accordingly.</Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VisitRescheduledText({
  name,
  workOrderNumber,
  workOrderTitle,
  oldStartTime,
  oldEndTime,
  newStartTime,
  newEndTime,
  timezone,
  workOrderUrl,
  address,
}: VisitRescheduledEmailProps): string {
  return `
Your Visit Was Rescheduled

Hello ${name},

The visit for ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle} has been rescheduled.

${workOrderNumber ? `Work Order: ${workOrderNumber}\n` : ''}${workOrderTitle}
${address ? `${address}\n` : ''}Was: ${formatWindow(oldStartTime, oldEndTime, timezone)}
Now: ${formatWindow(newStartTime, newEndTime, timezone)}

View Work Order: ${workOrderUrl}

Update your plans accordingly.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VisitRescheduledEmail

// Preview props for React Email dev server
VisitRescheduledEmail.PreviewProps = {
  name: 'Alex Rivera',
  workOrderNumber: 'WO-0042',
  workOrderTitle: 'Water heater replacement',
  oldStartTime: '2026-07-14T15:00:00.000Z',
  oldEndTime: '2026-07-14T17:00:00.000Z',
  newStartTime: '2026-07-15T18:00:00.000Z',
  newEndTime: '2026-07-15T20:00:00.000Z',
  timezone: 'America/Chicago',
  workOrderUrl: 'https://app.auxx.ai/app/work-orders/wo_0042',
  address: '123 Main St, Springfield, IL 62701',
}

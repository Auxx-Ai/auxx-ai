// packages/email/src/templates/general/visit-reassigned-email.tsx
//
// One template, two variants (plan 19 §4.9): 'removed' notifies the OLD assignee they're off
// the visit; 'assigned' notifies the NEW assignee they've been added. Neither variant is the
// full dispatch email — Dispatch stays the only sender of that (no auto re-dispatch).

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
export type VisitReassignedVariant = 'removed' | 'assigned'

interface VisitReassignedEmailProps {
  name: string
  variant: VisitReassignedVariant
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

export async function VisitReassignedEmail({
  name,
  variant,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: VisitReassignedEmailProps): Promise<React.JSX.Element> {
  const heading =
    variant === 'removed' ? "You've Been Removed From a Visit" : "You've Been Assigned a Visit"
  const intro =
    variant === 'removed'
      ? `You're no longer assigned to ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle}.`
      : `You've been assigned to ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle}.`

  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>{heading}</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>{intro}</Text>

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

        {variant === 'assigned' && <EmailButton href={workOrderUrl} label='View Work Order' />}

        <Text className='mb-0'>
          {variant === 'removed'
            ? 'No action needed — this visit is off your schedule.'
            : 'Check the job for details before you head out.'}
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VisitReassignedText({
  name,
  variant,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: VisitReassignedEmailProps): string {
  const heading =
    variant === 'removed' ? "You've Been Removed From a Visit" : "You've Been Assigned a Visit"
  const intro =
    variant === 'removed'
      ? `You're no longer assigned to ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle}.`
      : `You've been assigned to ${workOrderNumber ? `${workOrderNumber} — ` : ''}${workOrderTitle}.`

  return `
${heading}

Hello ${name},

${intro}

${workOrderNumber ? `Work Order: ${workOrderNumber}\n` : ''}${workOrderTitle}
${formatWindow(startTime, endTime, timezone)}
${variant === 'assigned' ? `\nView Work Order: ${workOrderUrl}\n` : ''}
${
  variant === 'removed'
    ? 'No action needed — this visit is off your schedule.'
    : 'Check the job for details before you head out.'
}

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VisitReassignedEmail

// Preview props for React Email dev server
VisitReassignedEmail.PreviewProps = {
  name: 'Alex Rivera',
  variant: 'assigned',
  workOrderNumber: 'WO-0042',
  workOrderTitle: 'Water heater replacement',
  startTime: '2026-07-14T15:00:00.000Z',
  endTime: '2026-07-14T17:00:00.000Z',
  timezone: 'America/Chicago',
  workOrderUrl: 'https://app.auxx.ai/app/work-orders/wo_0042',
}

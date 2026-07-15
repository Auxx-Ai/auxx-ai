// packages/email/src/templates/general/visit-daily-digest-email.tsx
//
// Opt-in daily schedule digest (plan 19 §4.9) — one email per worker per org-local day,
// listing every visit assigned to them that day. Skipped entirely (never enqueued) for
// workers with zero visits or `notification.dispatch.dailyDigest` off.

import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
export interface VisitDailyDigestItem {
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  address?: string
}

interface VisitDailyDigestEmailProps {
  name: string
  dateLabel: string
  timezone: string
  visits: VisitDailyDigestItem[]
  scheduleUrl: string
}

function formatTimeWindow(startTime: string, endTime: string, timezone: string): string {
  const start = new Date(startTime).toLocaleTimeString('en-US', {
    timeStyle: 'short',
    timeZone: timezone,
  })
  const end = new Date(endTime).toLocaleTimeString('en-US', {
    timeStyle: 'short',
    timeZone: timezone,
  })
  return `${start} – ${end}`
}

export async function VisitDailyDigestEmail({
  name,
  dateLabel,
  timezone,
  visits,
  scheduleUrl,
}: VisitDailyDigestEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Schedule for {dateLabel}</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          You have {visits.length} visit{visits.length === 1 ? '' : 's'} today:
        </Text>

        {visits.map((visit, i) => (
          <div
            key={`${visit.workOrderNumber}-${i}`}
            style={{
              backgroundColor: '#f7fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px',
              margin: '12px 0',
            }}>
            <Text style={{ margin: '4px 0', fontWeight: 'bold' }}>
              {formatTimeWindow(visit.startTime, visit.endTime, timezone)}
            </Text>
            <Text style={{ margin: '4px 0' }}>
              {visit.workOrderNumber ? `${visit.workOrderNumber} — ` : ''}
              {visit.workOrderTitle}
            </Text>
            {visit.address && (
              <Text style={{ margin: '4px 0', color: '#718096' }}>{visit.address}</Text>
            )}
          </div>
        ))}

        <EmailButton href={scheduleUrl} label='View Full Schedule' />

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function VisitDailyDigestText({
  name,
  dateLabel,
  timezone,
  visits,
  scheduleUrl,
}: VisitDailyDigestEmailProps): string {
  const lines = visits
    .map((visit) => {
      const window = formatTimeWindow(visit.startTime, visit.endTime, timezone)
      const label = `${visit.workOrderNumber ? `${visit.workOrderNumber} — ` : ''}${visit.workOrderTitle}`
      return `- ${window}: ${label}${visit.address ? ` (${visit.address})` : ''}`
    })
    .join('\n')

  return `
Your Schedule for ${dateLabel}

Hello ${name},

You have ${visits.length} visit${visits.length === 1 ? '' : 's'} today:

${lines}

View Full Schedule: ${scheduleUrl}

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default VisitDailyDigestEmail

// Preview props for React Email dev server
VisitDailyDigestEmail.PreviewProps = {
  name: 'Alex Rivera',
  dateLabel: 'Tuesday, July 14',
  timezone: 'America/Chicago',
  visits: [
    {
      workOrderNumber: 'WO-0042',
      workOrderTitle: 'Water heater replacement',
      startTime: '2026-07-14T15:00:00.000Z',
      endTime: '2026-07-14T17:00:00.000Z',
      address: '123 Main St, Springfield, IL 62701',
    },
    {
      workOrderNumber: 'WO-0043',
      workOrderTitle: 'HVAC tune-up',
      startTime: '2026-07-14T19:00:00.000Z',
      endTime: '2026-07-14T20:00:00.000Z',
    },
  ],
  scheduleUrl: 'https://app.auxx.ai/app/schedule',
}

// packages/email/src/templates/weekly-summary/weekly-summary-notification-email.tsx
import { Container, Hr, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

/**
 * Shape of the data consumed by the weekly summary notification email template.
 */
interface WeeklySummaryNotificationEmailProps {
  /** Recipient name displayed in the greeting section. */
  name: string
  /** Human readable period covered by the summary (e.g., "September 15-21"). */
  summaryPeriod: string
  /** List of highlight entries surfaced in the summary body. */
  highlights: Array<{ label: string; value: string }>
  /** Optional call-to-action destination used for the dashboard button. */
  ctaUrl?: string
}

/**
 * Generates the HTML version of the weekly summary notification email.
 */
export async function WeeklySummaryNotificationEmail({
  name,
  summaryPeriod,
  highlights,
  ctaUrl = 'https://app.auxx.ai/dashboard',
}: WeeklySummaryNotificationEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Weekly Summary is Ready</EmailHeading>
        <Text>Hello {name},</Text>
        <Text>
          Here is a quick recap of your activity for {summaryPeriod}. Catch up on highlights below
          and jump back in when you are ready.
        </Text>
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
            backgroundColor: '#f8fafc',
          }}>
          {highlights.map((highlight, index) => (
            <Text
              key={highlight.label}
              style={{ margin: index === 0 ? '0 0 12px 0' : '12px 0 0 0' }}>
              <strong>{highlight.label}:</strong> {highlight.value}
            </Text>
          ))}
        </div>
        <EmailButton href={ctaUrl} label='Open Dashboard' />
        <Hr style={{ borderColor: '#e2e8f0', margin: '24px 0' }} />
        <Text className='mb-0'>
          Need help making the most of these insights? Our team is here to support you with next
          steps.
        </Text>
        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

/**
 * Produces the plain-text representation for transactional delivery clients.
 */
export function WeeklySummaryNotificationText({
  name,
  summaryPeriod,
  highlights,
  ctaUrl = 'https://app.auxx.ai/dashboard',
}: WeeklySummaryNotificationEmailProps): string {
  const highlightLines = highlights
    .map((highlight) => `${highlight.label}: ${highlight.value}`)
    .join('\n')

  return `
Your Weekly Summary is Ready

Hello ${name},

Here is a quick recap of your activity for ${summaryPeriod}.

${highlightLines}

Open Dashboard: ${ctaUrl}

Need help making the most of these insights? Our team is here to support you with next steps.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default WeeklySummaryNotificationEmail

/** Preview configuration for the React Email development server. */
WeeklySummaryNotificationEmail.PreviewProps = {
  name: 'Taylor',
  summaryPeriod: 'September 15 - September 21',
  highlights: [
    { label: 'New leads', value: '8 (+23% vs last week)' },
    { label: 'Follow-ups completed', value: '14 tasks' },
    { label: 'Meetings scheduled', value: '5 upcoming' },
  ],
  ctaUrl: 'https://app.auxx.ai/dashboard',
}

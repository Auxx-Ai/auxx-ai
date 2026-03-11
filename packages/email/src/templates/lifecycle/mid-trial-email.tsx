// packages/email/src/templates/lifecycle/mid-trial-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface MidTrialEmailProps {
  name: string
  daysRemaining: number
  ticketsResolved?: number
  timeSaved?: number
  aiAccuracy?: number
  dashboardUrl?: string
  scheduleCallUrl?: string
}

export async function MidTrialEmail({
  name,
  daysRemaining,
  ticketsResolved = 0,
  timeSaved = 0,
  aiAccuracy = 0,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
  scheduleCallUrl = 'https://calendly.com/auxx-ai/demo',
}: MidTrialEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>You're Halfway Through Your Trial!</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Great progress! You've been using Auxx.ai for a week now, with{' '}
          <strong>{daysRemaining} days</strong> remaining in your trial. Let's look at what you've
          accomplished so far.
        </Text>

        {(ticketsResolved > 0 || timeSaved > 0) && (
          <div
            style={{
              backgroundColor: '#f0f9ff',
              border: '1px solid #0ea5e9',
              borderRadius: '8px',
              padding: '20px',
              margin: '20px 0',
            }}>
            <Text
              style={{
                margin: '0 0 16px 0',
                fontWeight: 'bold',
                fontSize: '16px',
                color: '#0f172a',
              }}>
              Your Trial Impact So Far:
            </Text>

            {ticketsResolved > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <Text
                  style={{ margin: '0', fontWeight: 'bold', fontSize: '24px', color: '#0ea5e9' }}>
                  {ticketsResolved}
                </Text>
                <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
                  Support tickets resolved
                </Text>
              </div>
            )}

            {timeSaved > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <Text
                  style={{ margin: '0', fontWeight: 'bold', fontSize: '24px', color: '#0ea5e9' }}>
                  {timeSaved} hours
                </Text>
                <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
                  Saved on support tasks
                </Text>
              </div>
            )}

            {aiAccuracy > 0 && (
              <div>
                <Text
                  style={{ margin: '0', fontWeight: 'bold', fontSize: '24px', color: '#0ea5e9' }}>
                  {aiAccuracy}%
                </Text>
                <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
                  AI response accuracy
                </Text>
              </div>
            )}
          </div>
        )}

        <Text style={{ fontWeight: 'bold', fontSize: '16px', marginTop: '24px' }}>
          Features You Might Have Missed:
        </Text>

        <ul style={{ paddingLeft: '20px', color: '#64748b' }}>
          <li>
            <strong>Auto-categorization:</strong> Let AI automatically tag and prioritize incoming
            tickets
          </li>
          <li>
            <strong>Knowledge base training:</strong> Upload FAQs and documentation to improve AI
            responses
          </li>
          <li>
            <strong>Team collaboration:</strong> Add team members to share the workload
          </li>
          <li>
            <strong>Custom workflows:</strong> Build automation rules for repetitive tasks
          </li>
        </ul>

        <div
          style={{
            backgroundColor: '#fefce8',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '10px 10px 5px 10px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>💡 Pro Tip</Text>
          <Text style={{ margin: '0', fontSize: '14px' }}>
            Companies that connect both email and Shopify see 3x faster response times and 40%
            higher customer satisfaction scores.
          </Text>
        </div>

        <Text>Want to maximize your remaining trial time? Our team is here to help!</Text>

        <div style={{ textAlign: 'center', margin: '24px 0' }}>
          <EmailButton href={scheduleCallUrl} label='Schedule a Quick Demo' />
          <Text style={{ margin: '12px 0', fontSize: '14px', color: '#64748b' }}>or</Text>
          <a href={dashboardUrl} style={{ color: '#0ea5e9', textDecoration: 'none' }}>
            Continue to App →
          </a>
        </div>

        <Text
          style={{ fontSize: '14px', fontStyle: 'italic', color: '#64748b', marginTop: '24px' }}>
          "Auxx.ai cut our response time by 70% and our customers love the faster, more accurate
          support. It's been a game-changer for our small team." - Alex Chen, Founder of TechGear
          Pro
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function MidTrialText({
  name,
  daysRemaining,
  ticketsResolved = 0,
  timeSaved = 0,
  aiAccuracy = 0,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
  scheduleCallUrl = 'https://calendly.com/auxx-ai/demo',
}: MidTrialEmailProps): string {
  let impactSection = ''
  if (ticketsResolved > 0 || timeSaved > 0 || aiAccuracy > 0) {
    impactSection = `
Your Trial Impact So Far:
${ticketsResolved > 0 ? `• ${ticketsResolved} support tickets resolved` : ''}
${timeSaved > 0 ? `• ${timeSaved} hours saved on support tasks` : ''}
${aiAccuracy > 0 ? `• ${aiAccuracy}% AI response accuracy` : ''}
`
  }

  return `
You're Halfway Through Your Trial!

Hi ${name},

Great progress! You've been using Auxx.ai for a week now, with ${daysRemaining} days remaining in your trial. Let's look at what you've accomplished so far.
${impactSection}
Features You Might Have Missed:
• Auto-categorization: Let AI automatically tag and prioritize incoming tickets
• Knowledge base training: Upload FAQs and documentation to improve AI responses
• Team collaboration: Add team members to share the workload
• Custom workflows: Build automation rules for repetitive tasks

💡 Pro Tip:
Companies that connect both email and Shopify see 3x faster response times and 40% higher customer satisfaction scores.

Want to maximize your remaining trial time? Our team is here to help!

Schedule a Quick Demo: ${scheduleCallUrl}
Or continue to your dashboard: ${dashboardUrl}

"Auxx.ai cut our response time by 70% and our customers love the faster, more accurate support. It's been a game-changer for our small team." - Alex Chen, Founder of TechGear Pro

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default MidTrialEmail

// Preview props for React Email dev server
MidTrialEmail.PreviewProps = {
  name: 'Sarah',
  daysRemaining: 7,
  ticketsResolved: 47,
  timeSaved: 12,
  aiAccuracy: 94,
  dashboardUrl: 'https://app.auxx.ai/dashboard',
  scheduleCallUrl: 'https://calendly.com/auxx-ai/demo',
}

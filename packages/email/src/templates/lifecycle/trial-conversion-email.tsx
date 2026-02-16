// packages/email/src/templates/lifecycle/trial-conversion-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface TrialConversionEmailProps {
  name: string
  trialEndDate: string
  totalTicketsResolved?: number
  totalTimeSaved?: number
  recommendedPlan?: string
  monthlyPrice?: number
  billingUrl?: string
}

export async function TrialConversionEmail({
  name,
  trialEndDate,
  totalTicketsResolved = 0,
  totalTimeSaved = 0,
  recommendedPlan = 'Growth',
  monthlyPrice = 99,
  billingUrl = `${WEBAPP_URL}/settings/plans`,
}: TrialConversionEmailProps): Promise<React.JSX.Element> {
  const hasUsageData = totalTicketsResolved > 0 || totalTimeSaved > 0

  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Your Auxx.ai Trial Ends Soon</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Your trial will end on <strong>{trialEndDate}</strong>. Don't lose the momentum you've
          built!
        </Text>

        {hasUsageData && (
          <>
            <Text style={{ fontWeight: 'bold', fontSize: '16px', marginTop: '24px' }}>
              Here's what Auxx.ai helped you achieve:
            </Text>

            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #10b981',
                borderRadius: '8px',
                padding: '20px',
                margin: '20px 0',
              }}>
              {totalTicketsResolved > 0 && (
                <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <Text
                      style={{
                        margin: '0',
                        fontWeight: 'bold',
                        fontSize: '28px',
                        color: '#10b981',
                      }}>
                      {totalTicketsResolved}
                    </Text>
                    <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
                      Tickets resolved with AI assistance
                    </Text>
                  </div>
                </div>
              )}

              {totalTimeSaved > 0 && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <Text
                      style={{
                        margin: '0',
                        fontWeight: 'bold',
                        fontSize: '28px',
                        color: '#10b981',
                      }}>
                      {totalTimeSaved} hours
                    </Text>
                    <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
                      Saved on customer support
                    </Text>
                  </div>
                </div>
              )}

              <div
                style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #d1fae5' }}>
                <Text
                  style={{ margin: '0', fontSize: '14px', fontWeight: 'bold', color: '#064e3b' }}>
                  That's ${Math.round(totalTimeSaved * 25)} worth of time saved at $25/hour!
                </Text>
              </div>
            </div>
          </>
        )}

        <div
          style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #3b82f6',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
            textAlign: 'center',
          }}>
          <Text style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#64748b' }}>
            Based on your usage, we recommend:
          </Text>
          <Text
            style={{ margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '24px', color: '#0f172a' }}>
            {recommendedPlan} Plan
          </Text>
          <Text style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#3b82f6' }}>
            ${monthlyPrice}/month
          </Text>
          <Text style={{ margin: '0', fontSize: '14px', color: '#64748b' }}>
            Continue without interruption • Cancel anytime
          </Text>
        </div>

        <EmailButton href={billingUrl} label='Continue with Auxx.ai' />

        <Text style={{ fontWeight: 'bold', marginTop: '32px' }}>
          What happens if you don't upgrade?
        </Text>
        <ul style={{ paddingLeft: '20px', color: '#64748b', fontSize: '14px' }}>
          <li>Your account will be downgraded to the free tier</li>
          <li>AI responses and automation will be limited</li>
          <li>Historical data will be preserved for 30 days</li>
          <li>You can upgrade anytime to restore full access</li>
        </ul>
        {/* 
        <div
          style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '16px',
            margin: '24px 0',
          }}>
          <Text style={{ margin: '0', fontSize: '14px', fontWeight: 'bold' }}>
            🎁 Limited Time Offer
          </Text>
          <Text style={{ margin: '8px 0 0 0', fontSize: '14px' }}>
            Upgrade in the next 48 hours and get 20% off your first month!
          </Text>
        </div> */}

        <Text style={{ fontSize: '14px', color: '#64748b' }}>
          Questions about pricing or need a custom plan? Reply to this email or schedule a call with
          our team.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function TrialConversionText({
  name,
  trialEndDate,
  totalTicketsResolved = 0,
  totalTimeSaved = 0,
  recommendedPlan = 'Growth',
  monthlyPrice = 99,
  billingUrl = `${WEBAPP_URL}/settings/plans`,
}: TrialConversionEmailProps): string {
  const hasUsageData = totalTicketsResolved > 0 || totalTimeSaved > 0
  let achievementSection = ''

  if (hasUsageData) {
    achievementSection = `
Here's what Auxx.ai helped you achieve:
${totalTicketsResolved > 0 ? `• ${totalTicketsResolved} tickets resolved with AI assistance` : ''}
${totalTimeSaved > 0 ? `• ${totalTimeSaved} hours saved on customer support` : ''}
${totalTimeSaved > 0 ? `• That's $${Math.round(totalTimeSaved * 25)} worth of time saved at $25/hour!` : ''}
`
  }

  return `
Your Auxx.ai Trial Ends Soon

Hi ${name},

Your trial will end on ${trialEndDate}. Don't lose the momentum you've built!
${achievementSection}
Based on your usage, we recommend:
${recommendedPlan} Plan - $${monthlyPrice}/month
Continue without interruption • Cancel anytime

Continue with Auxx.ai: ${billingUrl}

What happens if you don't upgrade?
• Your account will be downgraded to the free tier
• AI responses and automation will be limited
• Historical data will be preserved for 30 days
• You can upgrade anytime to restore full access

🎁 Limited Time Offer
Upgrade in the next 48 hours and get 20% off your first month!

Questions about pricing or need a custom plan? Reply to this email or schedule a call with our team.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default TrialConversionEmail

// Preview props for React Email dev server
TrialConversionEmail.PreviewProps = {
  name: 'Sarah',
  trialEndDate: 'December 15, 2024',
  totalTicketsResolved: 127,
  totalTimeSaved: 32,
  recommendedPlan: 'Growth',
  monthlyPrice: 99,
  billingUrl: 'https://app.auxx.ai/settings/plans',
}

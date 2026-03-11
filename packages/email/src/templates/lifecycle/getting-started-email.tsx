// packages/email/src/templates/lifecycle/getting-started-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React
interface GettingStartedEmailProps {
  name: string
  organizationName?: string
  dashboardUrl?: string
}

export async function GettingStartedEmail({
  name,
  organizationName,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
}: GettingStartedEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Let's Get You Started with Auxx.ai!</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Welcome to Auxx.ai! Over the next few days, we'll share resources to help you master the
          platform and transform your customer support.
        </Text>

        <Text style={{ fontWeight: 'bold', fontSize: '16px', marginTop: '24px' }}>
          Here are the 3 most important things to know right now:
        </Text>

        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <div style={{ marginBottom: '16px' }}>
            <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
              📧 Email Integration
            </Text>
            <Text style={{ margin: '4px 0', fontSize: '14px', color: '#64748b' }}>
              Connect your Gmail or Outlook to automatically import and manage support tickets.
              Every email becomes a trackable conversation with full context.
            </Text>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
              🤖 AI-Powered Responses
            </Text>
            <Text style={{ margin: '4px 0', fontSize: '14px', color: '#64748b' }}>
              Train your AI assistant with your knowledge base and watch it draft intelligent,
              context-aware responses that sound just like your team.
            </Text>
          </div>

          <div>
            <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
              🛍️ Shopify Integration
            </Text>
            <Text style={{ margin: '4px 0', fontSize: '14px', color: '#64748b' }}>
              Sync customer data and order history automatically. See complete purchase history and
              customer details right alongside support conversations.
            </Text>
          </div>
        </div>

        <Text>Ready to see these features in action?</Text>

        <EmailButton href={dashboardUrl} label='Explore Your Dashboard' />

        <Text style={{ marginTop: '24px' }}>
          <strong>Quick Start Checklist:</strong>
        </Text>
        <ul style={{ paddingLeft: '20px', color: '#64748b' }}>
          <li>Connect your email account (2 minutes)</li>
          <li>Import your Shopify store (1 minute)</li>
          <li>Upload knowledge base documents (5 minutes)</li>
          <li>Test your first AI-powered response (30 seconds)</li>
        </ul>

        <Text>
          Questions? Reply to this email or visit our help center. We're here to ensure your success
          with Auxx.ai.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function GettingStartedText({
  name,
  organizationName,
  dashboardUrl = `${WEBAPP_URL}/dashboard`,
}: GettingStartedEmailProps): string {
  return `
Let's Get You Started with Auxx.ai!

Hi ${name},

Welcome to Auxx.ai! Over the next few days, we'll share resources to help you master the platform and transform your customer support.

Here are the 3 most important things to know right now:

📧 Email Integration
Connect your Gmail or Outlook to automatically import and manage support tickets. Every email becomes a trackable conversation with full context.

🤖 AI-Powered Responses
Train your AI assistant with your knowledge base and watch it draft intelligent, context-aware responses that sound just like your team.

🛍️ Shopify Integration
Sync customer data and order history automatically. See complete purchase history and customer details right alongside support conversations.

Ready to see these features in action?
${dashboardUrl}

Quick Start Checklist:
• Connect your email account (2 minutes)
• Import your Shopify store (1 minute)
• Upload knowledge base documents (5 minutes)
• Test your first AI-powered response (30 seconds)

Questions? Reply to this email or visit our help center. We're here to ensure your success with Auxx.ai.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default GettingStartedEmail

// Preview props for React Email dev server
GettingStartedEmail.PreviewProps = {
  name: 'Sarah',
  organizationName: 'Acme Store',
  dashboardUrl: 'https://app.auxx.ai/dashboard',
}

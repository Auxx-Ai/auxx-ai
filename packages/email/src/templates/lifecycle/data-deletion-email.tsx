// packages/email/src/templates/lifecycle/data-deletion-email.tsx
import { HOMEPAGE_URL, WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'

const supportEmail = process.env.SUPPORT_EMAIL || 'support@auxx.ai'

import type React from 'react'
import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

interface DataDeletionEmailProps {
  name: string
  organizationName?: string
  deletionDate: string
  reactivateUrl?: string
  exportUrl?: string
}

export async function DataDeletionEmail({
  name,
  organizationName,
  deletionDate,
  reactivateUrl = `${WEBAPP_URL}/reactivate`,
  exportUrl = `${WEBAPP_URL}/settings/export`,
}: DataDeletionEmailProps): Promise<React.JSX.Element> {
  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>Important: Your Data Will Be Deleted Soon</EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          This is a reminder that your Auxx.ai account
          {organizationName ? ` for ${organizationName}` : ''} has been inactive for 30 days since
          your subscription ended.
        </Text>

        <div
          style={{
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '10px 10px 5px 10px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0', fontWeight: 'bold', fontSize: '16px', color: '#e7000b' }}>
            ⚠️ Your data will be permanently deleted on:
          </Text>
          <Text style={{ margin: '8px 0', fontWeight: 'bold', fontSize: '20px', color: '#dc2626' }}>
            {deletionDate}
          </Text>
        </div>

        <Text style={{ fontWeight: 'bold', marginTop: '24px' }}>What will be deleted:</Text>
        <ul style={{ paddingLeft: '20px', color: '#64748b', fontSize: '14px' }}>
          <li>All support tickets and conversations</li>
          <li>Customer information and contact details</li>
          <li>Knowledge base and training data</li>
          <li>Analytics and reporting history</li>
          <li>Integration settings and configurations</li>
          <li>Team member accounts and permissions</li>
        </ul>

        <Text style={{ fontWeight: 'bold', marginTop: '24px' }}>Your options:</Text>

        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '20px',
            margin: '20px 0',
          }}>
          <div style={{ marginBottom: '20px' }}>
            <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
              Option 1: Export Your Data
            </Text>
            <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
              Download a complete backup of your data before deletion. This includes all tickets,
              customer information, and conversation history.
            </Text>
            <div style={{ marginTop: '12px' }}>
              <EmailButton href={exportUrl} label='Export Data Now' />
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
            <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
              Option 2: Reactivate Your Account
            </Text>
            <Text style={{ margin: '8px 0', fontSize: '14px', color: '#64748b' }}>
              Resume your subscription to keep all your data and continue using Auxx.ai without
              interruption.
            </Text>
            <div style={{ marginTop: '12px' }}>
              <EmailButton href={reactivateUrl} label='Reactivate Account' />
            </div>
          </div>
        </div>

        <Text style={{ fontSize: '14px', color: '#64748b', marginTop: '24px' }}>
          <strong>Privacy Notice:</strong> In compliance with GDPR and data protection regulations,
          we will permanently delete all your data after the retention period. This action cannot be
          undone.
        </Text>

        <Text style={{ fontSize: '14px', color: '#64748b' }}>
          For more information about our data retention policy, please visit our{' '}
          <a href={`${HOMEPAGE_URL}/privacy`} style={{ color: '#3b82f6', textDecoration: 'none' }}>
            Privacy Policy
          </a>
          .
        </Text>

        <Text>
          If you have any questions or need assistance with data export, please contact our support
          team immediately at {supportEmail}.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function DataDeletionText({
  name,
  organizationName,
  deletionDate,
  reactivateUrl = `${WEBAPP_URL}/reactivate`,
  exportUrl = `${WEBAPP_URL}/settings/export`,
}: DataDeletionEmailProps): string {
  return `
Important: Your Data Will Be Deleted Soon

Hi ${name},

This is a reminder that your Auxx.ai account${organizationName ? ` for ${organizationName}` : ''} has been inactive for 30 days since your subscription ended.

⚠️ Your data will be permanently deleted on: ${deletionDate}

What will be deleted:
• All support tickets and conversations
• Customer information and contact details
• Knowledge base and training data
• Analytics and reporting history
• Integration settings and configurations
• Team member accounts and permissions

Your options:

Option 1: Export Your Data
Download a complete backup of your data before deletion. This includes all tickets, customer information, and conversation history.
Export Data Now: ${exportUrl}

Option 2: Reactivate Your Account
Resume your subscription to keep all your data and continue using Auxx.ai without interruption.
Reactivate Account: ${reactivateUrl}

Privacy Notice: In compliance with GDPR and data protection regulations, we will permanently delete all your data after the retention period. This action cannot be undone.

For more information about our data retention policy, please visit our Privacy Policy at ${HOMEPAGE_URL}/privacy.

If you have any questions or need assistance with data export, please contact our support team immediately at ${supportEmail}.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default DataDeletionEmail

// Preview props for React Email dev server
DataDeletionEmail.PreviewProps = {
  name: 'Sarah',
  organizationName: 'Acme Store',
  deletionDate: 'January 15, 2025',
  reactivateUrl: 'https://app.auxx.ai/reactivate',
  exportUrl: 'https://app.auxx.ai/settings/export',
}

// packages/email/src/templates/lifecycle/meta-channel-disconnected-email.tsx
import { WEBAPP_URL } from '@auxx/config/server'
import { Container, Text } from '@react-email/components'
import React from 'react'

import { EmailButton } from '../../components/email-button'
import { EmailFooter } from '../../components/email-footer'
import { EmailTemplate } from '../../components/email-template'
import { EmailHeading } from '../../components/email-text'

void React

const supportEmail = process.env.SUPPORT_EMAIL || 'support@auxx.ai'

/** Which Meta surface the affected channel lives on. */
export type MetaChannelPlatform = 'facebook' | 'instagram'

/**
 * Why Meta told us to tear the connection down.
 *
 * - `app-removed` — the person who connected the channel removed Auxx.ai from their
 *   Facebook settings (Meta's *deauthorize* callback). The channel is **paused**.
 * - `data-deletion` — that person asked Meta to delete their data (Meta's *data deletion*
 *   callback). Their tokens are erased and the channel is **disconnected**.
 */
export type MetaChannelDisconnectReason = 'app-removed' | 'data-deletion'

export interface MetaChannelDisconnectedEmailProps {
  /** Recipient's first name — an admin or owner of the organization. */
  name?: string
  /** The organization the channel belongs to. */
  organizationName: string
  /** Display name of the Facebook Page / Instagram account that stopped working. */
  channelName: string
  platform: MetaChannelPlatform
  reason: MetaChannelDisconnectReason
  /** Absolute link to the channels settings page. */
  channelsUrl?: string
}

type Copy = {
  platformLabel: string
  channelNoun: string
  inboxLabel: string
  stateLabel: string
  cause: string
  outcome: string
}

function buildCopy({
  platform,
  reason,
}: Pick<MetaChannelDisconnectedEmailProps, 'platform' | 'reason'>): Copy {
  const isInstagram = platform === 'instagram'
  const platformLabel = isInstagram ? 'Instagram' : 'Facebook'

  return {
    platformLabel,
    channelNoun: isInstagram ? 'Instagram account' : 'Facebook Page',
    inboxLabel: isInstagram ? 'Instagram direct messages' : 'Messenger messages',
    stateLabel: reason === 'app-removed' ? 'paused' : 'disconnected',
    cause:
      reason === 'app-removed'
        ? 'removed Auxx.ai from their personal Facebook settings'
        : 'asked Meta to delete the data Auxx.ai holds about them',
    outcome:
      reason === 'app-removed'
        ? 'we paused the channel'
        : 'we deleted the login details we held for them and disconnected the channel',
  }
}

/**
 * Notice sent to an organization's admins when Meta's deauthorize or data-deletion callback
 * forces one of their Facebook/Instagram channels offline.
 */
export async function MetaChannelDisconnectedEmail({
  name = 'there',
  organizationName,
  channelName,
  platform,
  reason,
  channelsUrl = `${WEBAPP_URL}/app/settings/channels`,
}: MetaChannelDisconnectedEmailProps): Promise<React.JSX.Element> {
  const copy = buildCopy({ platform, reason })

  return (
    <EmailTemplate>
      <Container>
        <EmailHeading>
          Your {copy.platformLabel} channel "{channelName}" is {copy.stateLabel}
        </EmailHeading>
        <Text>Hi {name},</Text>
        <Text>
          Someone who connected the {copy.channelNoun} <strong>{channelName}</strong> to{' '}
          {organizationName} {copy.cause}. Meta let us know, so {copy.outcome}.
        </Text>
        <Text>
          Until it is reconnected, new {copy.inboxLabel} sent to {channelName} will not reach your
          Auxx.ai inbox, and replies sent from Auxx.ai will not go out.
        </Text>

        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px 16px 4px 16px',
            margin: '20px 0',
          }}>
          <Text style={{ margin: '0', fontWeight: 'bold', color: '#0f172a' }}>
            Your conversation history is safe
          </Text>
          <Text style={{ margin: '8px 0 12px 0', fontSize: '14px', color: '#64748b' }}>
            Nothing was deleted from {organizationName}. Every {copy.platformLabel} conversation,
            message, attachment and contact stays exactly where it is, and stays searchable. What we
            removed was only the personal access we held on behalf of the person who connected the
            channel — never your team's customer conversations.
          </Text>
        </div>

        <Text style={{ fontWeight: 'bold', marginTop: '24px' }}>How to get it working again</Text>
        <Text>
          Open Settings &rarr; Channels and reconnect {channelName}. Whoever reconnects needs admin
          access to the {copy.channelNoun} — it does not have to be the same person who set it up
          originally.
        </Text>
        <div style={{ margin: '20px 0' }}>
          <EmailButton href={channelsUrl} label='Reconnect channel' />
        </div>

        <Text style={{ fontSize: '14px', color: '#64748b', marginTop: '24px' }}>
          Meta does not tell us who made the request, so if this is unexpected it is worth checking
          with whoever originally connected {channelName}.
        </Text>
        <Text style={{ fontSize: '14px', color: '#64748b' }}>
          If you get stuck reconnecting, contact us at {supportEmail} and we will help.
        </Text>

        <EmailFooter />
      </Container>
    </EmailTemplate>
  )
}

// Text version
export function MetaChannelDisconnectedText({
  name = 'there',
  organizationName,
  channelName,
  platform,
  reason,
  channelsUrl = `${WEBAPP_URL}/app/settings/channels`,
}: MetaChannelDisconnectedEmailProps): string {
  const copy = buildCopy({ platform, reason })

  return `
Your ${copy.platformLabel} channel "${channelName}" is ${copy.stateLabel}

Hi ${name},

Someone who connected the ${copy.channelNoun} ${channelName} to ${organizationName} ${copy.cause}. Meta let us know, so ${copy.outcome}.

Until it is reconnected, new ${copy.inboxLabel} sent to ${channelName} will not reach your Auxx.ai inbox, and replies sent from Auxx.ai will not go out.

YOUR CONVERSATION HISTORY IS SAFE
Nothing was deleted from ${organizationName}. Every ${copy.platformLabel} conversation, message, attachment and contact stays exactly where it is, and stays searchable. What we removed was only the personal access we held on behalf of the person who connected the channel — never your team's customer conversations.

How to get it working again
Open Settings -> Channels and reconnect ${channelName}. Whoever reconnects needs admin access to the ${copy.channelNoun} — it does not have to be the same person who set it up originally.

Reconnect channel: ${channelsUrl}

Meta does not tell us who made the request, so if this is unexpected it is worth checking with whoever originally connected ${channelName}.

If you get stuck reconnecting, contact us at ${supportEmail} and we will help.

--
Best regards,
The Auxx.ai Team
  `.trim()
}

export default MetaChannelDisconnectedEmail

// Preview props for React Email dev server
MetaChannelDisconnectedEmail.PreviewProps = {
  name: 'Sarah',
  organizationName: 'Acme Store',
  channelName: 'Acme Store Support',
  platform: 'facebook',
  reason: 'app-removed',
  channelsUrl: 'https://app.auxx.ai/app/settings/channels',
} satisfies MetaChannelDisconnectedEmailProps

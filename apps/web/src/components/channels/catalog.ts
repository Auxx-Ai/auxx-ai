// apps/web/src/components/channels/catalog.ts
// Client-side catalog backing the channel gallery dialog (replaces the hardcoded
// `settings/channels/new` card grid). Each item feeds `TemplateGalleryDialog`; its
// `kind` selects which detail step renders (see channel-gallery-dialog.tsx).

import type { TemplateGalleryCategory, TemplateGalleryItem } from '~/components/templates/ui'

/** Which detail step a catalog item opens. */
export type ChannelKind = 'oauth-email' | 'imap' | 'chat' | 'social' | 'phone' | 'coming-soon'

export interface ChannelCatalogItem extends TemplateGalleryItem {
  kind: ChannelKind
  /** OAuth channel provider (drives `channel.prepareConnect`) for email + social kinds. */
  provider?: 'google' | 'outlook' | 'facebook' | 'instagram'
  /** Platform connection providerKey for secret-connection kinds (Quo). */
  providerKey?: string
  /** Rendered as a disabled "coming soon" row. */
  disabled?: boolean
}

/** Gallery category sidebar. `all` is required by TemplateGalleryDialog. `icon` is an ICON_DATA id. */
export const CHANNEL_CATEGORIES: readonly TemplateGalleryCategory[] = [
  { value: 'all', label: 'All', icon: 'layers' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'chat', label: 'Chat', icon: 'message-square' },
  { value: 'social', label: 'Social', icon: 'share-2' },
  { value: 'phone', label: 'Phone', icon: 'phone' },
]

export const CHANNEL_CATALOG: ChannelCatalogItem[] = [
  {
    id: 'google',
    name: 'Gmail',
    description: 'Connect a Gmail account to send and receive email.',
    categories: ['email'],
    kind: 'oauth-email',
    provider: 'google',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    description: 'Connect a Microsoft Outlook account to send and receive email.',
    categories: ['email'],
    kind: 'oauth-email',
    provider: 'outlook',
  },
  {
    id: 'imap',
    name: 'IMAP Email',
    description: 'Connect any IMAP/SMTP email server (self-hosted, enterprise).',
    categories: ['email'],
    kind: 'imap',
  },
  {
    id: 'chat',
    name: 'Chat Widget',
    description: 'Add a live chat widget to your website.',
    categories: ['chat'],
    kind: 'chat',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect a Facebook Page to manage messages.',
    categories: ['social'],
    kind: 'social',
    provider: 'facebook',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect an Instagram Professional account to manage direct messages.',
    categories: ['social'],
    kind: 'social',
    provider: 'instagram',
  },
  {
    id: 'openphone',
    name: 'Quo',
    description: 'Connect your Quo (OpenPhone) account to send and receive SMS.',
    categories: ['phone'],
    kind: 'phone',
    providerKey: 'openphone',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Connect a WhatsApp Business account — coming soon.',
    categories: ['chat'],
    kind: 'coming-soon',
    disabled: true,
  },
]

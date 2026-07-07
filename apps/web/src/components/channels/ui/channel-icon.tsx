// apps/web/src/components/channels/ui/channel-icon.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Mail, MessageCircle, MessageSquare, Phone } from 'lucide-react'
import type React from 'react'
import { FacebookIcon, GoogleIcon, InstagramIcon, OutlookIcon } from '~/constants/icons'

/**
 * Provider/channel-type → brand (or utility) icon, sized `size-5` by default.
 * Keyed by both Integration `provider` values (list cards) and catalog `type`
 * values (gallery) — they share the same slugs. Unknown types fall back to Mail.
 */
export function getIntegrationProviderIcon(provider: string, className?: string) {
  const iconMap: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
    google: GoogleIcon,
    outlook: OutlookIcon,
    facebook: FacebookIcon,
    instagram: InstagramIcon,
    openphone: Phone,
    chat: MessageSquare,
    whatsapp: MessageCircle,
    imap: Mail,
  }
  const IconComponent = iconMap[provider.toLowerCase()]
  if (IconComponent) return <IconComponent className={cn('size-5', className)} />
  return <Mail className={cn('size-5 text-gray-500', className)} />
}

/** Provider slug → human label for channel cards and menus. */
export function getChannelProviderName(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'google':
      return 'Gmail'
    case 'outlook':
      return 'Outlook'
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    case 'openphone':
      return 'Quo'
    case 'chat':
      return 'Chat Widget'
    case 'imap':
      return 'IMAP Email'
    case 'email':
      return 'Forwarding'
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
}

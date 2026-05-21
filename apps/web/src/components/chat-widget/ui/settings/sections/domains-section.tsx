// apps/web/src/components/chat-widget/ui/settings/sections/domains-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { toastError } from '@auxx/ui/components/toast'
import { Globe } from 'lucide-react'
import { EmailFilterSection } from '~/app/(protected)/app/settings/channels/_components/email-list-dialog'
import { api } from '~/trpc/react'

interface DomainsSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

export function DomainsSection({ widget, channelId }: DomainsSectionProps) {
  const utils = api.useUtils()

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  return (
    <div className='p-6'>
      <EmailFilterSection
        icon={<Globe className='size-4' />}
        title='Allowed Domains'
        description='Restrict where the widget can be embedded. Empty list = allow anywhere.'
        emptyHint='Disabled — widget loads on any site'
        dialogTitle='Allowed Domains'
        dialogDescription='Only these domains will be allowed to embed the widget.'
        dialogPlaceholder='example.com'
        entries={widget.chatWidget?.allowedDomains ?? []}
        onSave={(entries) => update.mutate({ integrationId: channelId, allowedDomains: entries })}
        isPending={update.isPending}
        activeWarning='Widget will only load on these domains.'
      />
    </div>
  )
}

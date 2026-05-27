// apps/web/src/components/chat-widget/ui/settings/chat-widget-settings.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import {
  AlertCircle,
  ExternalLink,
  Palette,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useChatWidget } from '../../hooks/use-chat-widget'
import { AppearanceSection } from './sections/appearance-section'
import { BehaviorSection } from './sections/behavior-section'
import { GeneralSection } from './sections/general-section'
import { IdentitySection } from './sections/identity-section'

interface ChatWidgetSettingsProps {
  channelId: string
}

type SectionId = 'general' | 'appearance' | 'behavior' | 'identity'

const SETTINGS_SECTIONS: { id: SectionId; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'behavior', label: 'Behavior', icon: SlidersHorizontal },
  { id: 'identity', label: 'Identity', icon: ShieldCheck },
]

export function ChatWidgetSettings({ channelId }: ChatWidgetSettingsProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [activeSection, setActiveSection] = useQueryState('s', {
    defaultValue: 'general',
  }) as [SectionId, (s: string) => void]

  const { data, isLoading, error } = useChatWidget(channelId)
  const disconnectChannel = api.channel.disconnect.useMutation()

  const openPreview = () => {
    const width = 900
    const height = 800
    const left = Math.max(0, (window.screen.availWidth - width) / 2)
    const top = Math.max(0, (window.screen.availHeight - height) / 2)
    const url = `/preview/widget/${channelId}?v=${Date.now()}`
    const target = `chat-widget-preview-${channelId}`
    const popup = window.open(
      url,
      target,
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`
    )
    // window.open with a named target focuses the existing popup without
    // reloading — force a fresh load so the new `v` is picked up and the
    // config cache is bypassed.
    if (popup) {
      try {
        popup.location.replace(url)
      } catch {
        /* cross-origin or closed — nothing to do */
      }
      popup.focus()
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete chat widget?',
      description:
        'This permanently removes the widget and disconnects it from any inboxes. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    disconnectChannel.mutate(
      { integrationId: channelId },
      {
        onSuccess: () => {
          utils.channel.list.invalidate()
          router.push('/app/settings/channels')
        },
        onError: (e) => toastError({ title: 'Failed to delete', description: e.message }),
      }
    )
  }

  if (isLoading) {
    return (
      <SettingsPage
        title='Loading…'
        description='Chat widget settings'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Channels', href: '/app/settings/channels' },
          { title: 'Chat Widget' },
        ]}>
        <div className='space-y-4 p-6'>
          <Skeleton className='h-10 w-full max-w-md' />
          <Skeleton className='h-64 w-full' />
        </div>
      </SettingsPage>
    )
  }

  if (error || !data || !data.chatWidget) {
    return (
      <SettingsPage
        title='Chat Widget'
        description='Chat widget not found'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Channels', href: '/app/settings/channels' },
          { title: 'Chat Widget' },
        ]}>
        <div className='p-6'>
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {error?.message ?? 'This chat widget could not be loaded.'}
            </AlertDescription>
          </Alert>
        </div>
      </SettingsPage>
    )
  }

  const widget = data as ChatWidgetWithIntegration
  const widgetName = widget.name || widget.chatWidget?.name || 'Chat Widget'

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'appearance':
        return <AppearanceSection widget={widget} channelId={channelId} />
      case 'behavior':
        return <BehaviorSection widget={widget} channelId={channelId} />
      case 'identity':
        return <IdentitySection widget={widget} channelId={channelId} />
      default:
        return <GeneralSection widget={widget} channelId={channelId} onDelete={handleDelete} />
    }
  }

  return (
    <SettingsPage
      title={widgetName}
      description='Configure your chat widget'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Channels', href: '/app/settings/channels' },
        { title: widgetName },
      ]}
      button={
        <Button variant='outline' size='sm' onClick={openPreview}>
          <ExternalLink className='mr-2 h-4 w-4' />
          Open preview
        </Button>
      }>
      <ConfirmDialog />
      <div className='overflowy-y-auto h-full flex-1'>
        <div className='p-3 backdrop-blur-sm sticky top-0 z-10 bg-background/70 border-b border-border'>
          <RadioTab
            value={activeSection}
            onValueChange={setActiveSection}
            size='sm'
            radioGroupClassName='grid w-full grid-cols-4'
            className='border border-primary-200 flex w-full'>
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <RadioTabItem key={section.id} value={section.id} size='sm'>
                  <Icon />
                  {section.label}
                </RadioTabItem>
              )
            })}
          </RadioTab>
        </div>
        {renderActiveSection()}
      </div>
    </SettingsPage>
  )
}

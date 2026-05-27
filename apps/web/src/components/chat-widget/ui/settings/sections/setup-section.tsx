// apps/web/src/components/chat-widget/ui/settings/sections/setup-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { ArrowUpRight, Check, Code, Copy, ExternalLink } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

interface SetupSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

export function SetupSection({ channelId }: SetupSectionProps) {
  const { docsUrl } = useEnv()
  const { data: installCode, isLoading: installLoading } = api.channel.getInstallationCode.useQuery(
    { integrationId: channelId }
  )
  const { copied: copiedLink, copy: copyLink } = useCopy({
    toastMessage: 'Install snippet copied to clipboard',
  })

  const openFullPreview = () => {
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
    if (popup) {
      try {
        popup.location.replace(url)
      } catch {
        /* cross-origin or closed — nothing to do */
      }
      popup.focus()
    }
  }

  return (
    <div className='p-6 space-y-8'>
      <div>
        <div className='space-y-1 mb-4'>
          <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
            <Code className='size-4' /> Install
          </div>
          <p className='text-sm text-muted-foreground'>
            Paste this snippet into your site's HTML, ideally just before <code>&lt;/body&gt;</code>
            .
          </p>
        </div>
        <InputGroup>
          <InputGroupAddon align='inline-start'>
            <Code />
          </InputGroupAddon>
          {installLoading ? (
            <InputGroupText className='flex-1'>
              <Skeleton className='h-4 w-full' />
            </InputGroupText>
          ) : installCode?.script ? (
            <InputGroupInput
              type='text'
              value={installCode.script}
              readOnly
              className='font-mono text-xs'
              onFocus={(e) => e.target.select()}
            />
          ) : (
            <InputGroupText className='text-destructive'>
              Could not load installation code.
            </InputGroupText>
          )}
          <InputGroupAddon align='inline-end' className='gap-0.5'>
            <Tooltip content='Copy'>
              <InputGroupButton
                aria-label='Copy install snippet'
                className='rounded-full'
                size='icon-xs'
                disabled={!installCode?.script}
                onClick={() => installCode?.script && copyLink(installCode.script)}>
                {copiedLink ? <Check /> : <Copy />}
              </InputGroupButton>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>

        <ul className='mt-4 space-y-1.5 pl-5 text-sm text-muted-foreground list-disc marker:text-muted-foreground/60'>
          <li>
            Paste the snippet just before <code>&lt;/body&gt;</code> on every page that should show
            the widget.
          </li>
          <li>
            Pass visitor info via <code>window.AuxxChat.identify(…)</code> so conversations attach
            to a known contact.
          </li>
          <li>
            For verified identity, see the <strong>Identity</strong> tab — sign a per-session JWT on
            your server and pass it to <code>Auxx.boot()</code>.
          </li>
        </ul>

        <div className='mt-4 flex items-center gap-4'>
          <a
            href={`${docsUrl}/help/channels/chat-widget`}
            target='_blank'
            rel='noreferrer'
            className='inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline'>
            Read the full setup guide
            <ArrowUpRight className='size-3.5' />
          </a>
          <button
            type='button'
            onClick={openFullPreview}
            className='inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline'>
            Open full preview
            <ExternalLink className='size-3.5' />
          </button>
        </div>
      </div>
    </div>
  )
}

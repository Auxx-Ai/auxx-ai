// apps/web/src/components/chat-widget/ui/settings/sections/setup-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { AngularIcon } from '@auxx/ui/components/icons/angular-icon'
import { NpmIcon } from '@auxx/ui/components/icons/npm-icon'
import { ReactIcon } from '@auxx/ui/components/icons/react-icon'
import { VueIcon } from '@auxx/ui/components/icons/vue-icon'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ArrowUpRight, Code, ExternalLink } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import CodeEditor from '~/components/workflow/ui/code-editor'
import { CodeLanguage } from '~/components/workflow/ui/code-editor/types'
import { useEnv } from '~/providers/dehydrated-state-provider'
import {
  getSetupSnippets,
  type SetupCodeFlavor,
  type SetupFramework,
  type SetupSnippet,
} from './setup-snippets'
import { ShopifyCard } from './shopify-card'

interface SetupSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

const FRAMEWORKS = ['code', 'react', 'vue', 'angular'] as const
const FLAVORS = ['basic-js', 'npm', 'spa'] as const

export function SetupSection({ widget, channelId }: SetupSectionProps) {
  const { docsUrl } = useEnv()
  const [, setActiveSection] = useQueryState('s')
  const [framework, setFramework] = useQueryState(
    'framework',
    parseAsStringLiteral(FRAMEWORKS).withDefault('code')
  )
  const [flavor, setFlavor] = useQueryState(
    'flavor',
    parseAsStringLiteral(FLAVORS).withDefault('basic-js')
  )

  const audience = (widget.chatWidget?.chatAudience ?? 'visitors') as 'visitors' | 'both' | 'users'
  const verified = audience !== 'visitors'

  const snippets = useMemo(() => getSetupSnippets(channelId, audience), [channelId, audience])

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

  const activeSnippet: SetupSnippet =
    framework === 'code'
      ? snippets.code[flavor]
      : framework === 'react'
        ? snippets.react
        : framework === 'vue'
          ? snippets.vue
          : snippets.angular

  return (
    <div className='p-3 sm:p-6 space-y-8'>
      <SettingsSection
        icon={Code}
        title='Install'
        description='Choose your stack. The snippet below is ready to paste.'>
        <p className='mb-3 text-xs text-muted-foreground'>
          {verified
            ? 'Your server signs a short-lived JWT so the widget knows exactly which logged-in user it’s talking to. Messages can’t be spoofed and chats link back to the real account.'
            : 'Anyone visiting your site shows up as an anonymous chat visitor — fastest to install, no backend changes needed. Change Audience on the General tab once you want to verify logged-in users.'}
        </p>

        {verified && (
          <div className='mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground'>
            <span>
              You&apos;ll need a signing key — create one on the Identity tab, then put it in your
              server&apos;s <code className='font-mono'>AUXX_CHAT_SECRET</code> env var.
            </span>
            <button
              type='button'
              onClick={() => setActiveSection('identity')}
              className='inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline'>
              Open Identity
              <ArrowUpRight className='size-3' />
            </button>
          </div>
        )}

        <RadioTab
          value={framework}
          onValueChange={(v) => setFramework(v as SetupFramework)}
          size='sm'
          radioGroupClassName='grid w-full grid-cols-4'
          className='border border-primary-200 flex w-full mb-3'>
          <RadioTabItem value='code' size='sm'>
            <Code />
            Vanilla JS
          </RadioTabItem>
          <RadioTabItem value='react' size='sm'>
            <ReactIcon />
            React
          </RadioTabItem>
          <RadioTabItem value='vue' size='sm'>
            <VueIcon />
            Vue
          </RadioTabItem>
          <RadioTabItem value='angular' size='sm'>
            <AngularIcon />
            Angular
          </RadioTabItem>
        </RadioTab>

        {framework === 'code' && (
          <RadioTab
            value={flavor}
            onValueChange={(v) => setFlavor(v as SetupCodeFlavor)}
            size='sm'
            radioGroupClassName='grid w-full grid-cols-3'
            className='border border-primary-200 flex w-full mb-4'>
            <RadioTabItem value='basic-js' size='sm'>
              <Code />
              Basic JS
            </RadioTabItem>
            <RadioTabItem value='npm' size='sm'>
              <NpmIcon />
              npm package
            </RadioTabItem>
            <RadioTabItem value='spa' size='sm'>
              <Code />
              Single page app
            </RadioTabItem>
          </RadioTab>
        )}

        <div className='space-y-3'>
          {activeSnippet.blocks.map((block, i) => {
            const lines = block.value.split('\n').length
            const isShell = block.language === CodeLanguage.shell
            // header (28) + lines * 18 (CODE_EDITOR_LINE_HEIGHT) + 24px padding
            const minHeight = isShell ? 56 : 28 + lines * 18 + 24
            return (
              <CodeEditor
                key={`${audience}-${framework}-${flavor}-${i}`}
                language={block.language}
                value={block.value}
                readOnly
                title={block.title ?? activeSnippet.label}
                minHeight={minHeight}
              />
            )
          })}
          <p className='text-sm text-muted-foreground'>{activeSnippet.note}</p>
        </div>

        {/* Platforms axis — the frameworks above are "paste this snippet"; Shopify installs
            the widget through the Auxx app instead, so it gets its own control rather than
            a snippet. */}
        <div className='mt-6'>
          <p className='mb-2 text-xs font-medium text-muted-foreground'>Or install on a platform</p>
          <ShopifyCard channelId={channelId} />
        </div>

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
      </SettingsSection>
    </div>
  )
}

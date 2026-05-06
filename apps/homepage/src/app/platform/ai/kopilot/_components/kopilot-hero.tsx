// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-hero.tsx

import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { MockAppSidebar, MockBrowserChrome, MockKopilotWindow, MockMainPage } from '../../_mocks'
import { KOPILOT_HERO_SCRIPT } from './kopilot-hero-script'

export default function KopilotHero() {
  return (
    <section className='relative overflow-hidden border-b bg-muted/50'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/10,_transparent_60%)]'
      />
      <div className='mx-auto max-w-6xl px-6 pb-16 pt-32 text-center md:pt-40 lg:pt-48'>
        <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
          <Sparkles className='size-3.5 text-amber-500' />
          <span className='text-muted-foreground'>Workspace copilot</span>
        </div>

        <h1 className='mt-6 text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
          <span className='bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text italic text-transparent'>
            Ask
          </span>{' '}
          Kopilot.
        </h1>
        <div className='relative'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-x-0 -top-8 mx-auto h-40 max-w-2xl rounded-full bg-gradient-to-b from-blue-500/10 via-purple-500/10 to-pink-500/10 blur-3xl'
          />
          <p className='relative mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground'>
            Search, update, and create with AI.
          </p>
          <p className='relative mx-auto mt-2 max-w-xl text-balance text-sm text-muted-foreground/75'>
            Engineered for support. Unified by design. Powered by your data.
          </p>
        </div>

        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start for free</Link>
          </Button>
          <Button asChild size='sm' variant='outline'>
            <Link href={config.urls.demo}>Talk to sales</Link>
          </Button>
        </div>

        <div className='mt-16 text-left'>
          <MockBrowserChrome variant='regular'>
            <div className='flex h-[560px]'>
              <MockAppSidebar activeKey='kopilot' className='hidden md:flex' />
              <MockMainPage>
                <MockKopilotWindow
                  breadcrumb={{
                    trail: ['Chats'],
                    title: 'Open Support Tickets Summary',
                    titleMobile: 'Tickets',
                  }}
                  script={KOPILOT_HERO_SCRIPT}
                  composerPlaceholder='Ask Kopilot...'
                  modelLabel='GPT-5.4 Nano'
                />
              </MockMainPage>
            </div>
          </MockBrowserChrome>
        </div>
      </div>
    </section>
  )
}

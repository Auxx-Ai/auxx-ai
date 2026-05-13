// apps/homepage/src/app/_components/sections/kopilot-home-section.tsx

import {
  MockAppSidebar,
  MockBrowserChrome,
  MockKopilotWindow,
  MockMainPage,
} from '~/app/platform/ai/_mocks'
import { KOPILOT_HERO_SCRIPT } from '~/app/platform/ai/kopilot/_components/kopilot-hero-script'

export default function KopilotHomeSection() {
  return (
    <section className='relative bg-background border-b border-foreground/10'>
      <div className='mx-auto max-w-6xl px-6 pt-24'>
        <h2 className='mx-auto max-w-3xl text-balance text-center text-4xl font-semibold md:text-5xl'>
          Your AI assistant for every support question.
        </h2>
        <p className='mx-auto mt-4 max-w-2xl text-balance text-center text-lg text-muted-foreground'>
          Kopilot searches your tickets, contacts, knowledge base, and datasets — and grounds every
          answer in real records, not invention.
        </p>
      </div>

      <div className='mx-auto max-w-6xl px-6 pt-12 pb-24 text-left'>
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
    </section>
  )
}

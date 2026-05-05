// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-hero.tsx

import { ArrowUp, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

const draftLines = [
  'Refund policy → 30 days, unused items',
  'Order #4521 → flagged shipping delay',
  'Suggest reply: "Apologies for the late delivery..."',
]

export default function KopilotHero() {
  return (
    <section className='relative overflow-hidden border-b bg-background'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/10,_transparent_60%)]'
      />
      <div className='mx-auto max-w-5xl px-6 pb-16 pt-32 text-center md:pt-40 lg:pt-48'>
        <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
          <Sparkles className='size-3.5 text-amber-500' />
          <span className='text-muted-foreground'>Workspace copilot</span>
        </div>

        <h1 className='mt-6 text-balance text-5xl font-semibold tracking-tight md:text-7xl'>
          Ask Kopilot.
        </h1>
        <p className='mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground'>
          Search, update, and create with AI.
        </p>
        <p className='mx-auto mt-2 max-w-xl text-balance text-sm text-muted-foreground/75'>
          Engineered for support. Unified by design. Powered by your data.
        </p>

        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start for free</Link>
          </Button>
          <Button asChild size='sm' variant='outline'>
            <Link href={config.urls.demo}>Talk to sales</Link>
          </Button>
        </div>

        <ChatMock />
      </div>
    </section>
  )
}

function ChatMock() {
  return (
    <div className='mx-auto mt-16 max-w-2xl text-left'>
      <div className='rounded-xl border border-foreground/10 bg-card shadow-xl shadow-black/5'>
        <div className='flex items-center gap-2 border-b border-foreground/5 px-4 py-2'>
          <span className='size-2 rounded-full bg-foreground/10' />
          <span className='size-2 rounded-full bg-foreground/10' />
          <span className='size-2 rounded-full bg-foreground/10' />
          <span className='ml-2 text-muted-foreground text-xs'>Kopilot</span>
        </div>

        <div className='space-y-4 p-5'>
          <div className='ml-auto w-fit max-w-md rounded-2xl rounded-br-sm bg-foreground/5 px-3 py-2 text-sm'>
            Why did order #4521 ship late?
          </div>

          <div className='space-y-2'>
            <div className='text-muted-foreground text-xs'>Looking up...</div>
            <ul className='space-y-1.5'>
              {draftLines.map((line, i) => (
                <li
                  key={i}
                  className='flex items-center gap-2 rounded-md border border-foreground/5 bg-background px-3 py-2 text-sm'>
                  <span className='size-1.5 rounded-full bg-emerald-500' />
                  <span className='text-foreground/80'>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className='flex items-center gap-2 border-t border-foreground/5 px-3 py-2'>
          <input
            type='text'
            placeholder='Ask anything...'
            disabled
            className='flex-1 bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none'
          />
          <button
            type='button'
            disabled
            className='flex size-7 items-center justify-center rounded-full bg-foreground text-background'>
            <ArrowUp className='size-4' />
          </button>
        </div>
      </div>
    </div>
  )
}

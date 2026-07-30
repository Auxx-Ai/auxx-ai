// apps/homepage/src/app/platform/ai/agents/_components/agents-hero.tsx

import { Bot } from 'lucide-react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { AgentsBrowserDemo } from '../_mocks'

/**
 * Centered copy over a dot grid, flowing into a mock of the agent *list*
 * surface. Deliberately not the detail view: the run illustration dissects that
 * one section down, and it should not be spent twice.
 */
export default function AgentsHero() {
  return (
    <section className='relative overflow-hidden border-b'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-foreground)_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.06] [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_90%)]'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--color-primary)/8,_transparent_60%)]'
      />

      <div className='relative mx-auto max-w-6xl px-6 pb-20 pt-24 md:pt-32 lg:pt-36'>
        <div className='relative z-10 mx-auto max-w-2xl text-center'>
          <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
            <Bot className='size-3.5 text-violet-500' />
            <span className='text-muted-foreground'>AI CRM · Agents</span>
          </div>

          <h1 className='mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl'>
            Agents that follow
            <br />
            your process.
          </h1>
          <p className='mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground'>
            Write the playbook in plain language. The agent runs it step by step, calls only the
            tools you gave it, and proves it before it ever talks to a customer.
          </p>

          <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
            <Button asChild size='sm'>
              <Link href={config.urls.signup}>Start for free</Link>
            </Button>
            <Button asChild size='sm' variant='outline'>
              <Link href={config.urls.demo}>Talk to sales</Link>
            </Button>
          </div>
        </div>

        <AgentsBrowserDemo className='relative z-10 mt-14' />
      </div>
    </section>
  )
}

// apps/homepage/src/app/platform/ai/agents/_components/agent-run-section.tsx

import { Settings2, ShieldCheck, Wrench, Zap } from 'lucide-react'
import { cn } from '~/lib/utils'
import AgentRunIllustration from './agent-run-illustration'

interface AgentRunSectionProps {
  /**
   * Full-bleed top and bottom rules. Needed on the main homepage, where this
   * sits between two `bg-background` sections and the muted band would
   * otherwise float without an edge. The agents page doesn't set it: the
   * roster above already ends in a `border-b`, so it would double up.
   */
  bordered?: boolean
}

const capabilities = [
  {
    icon: Wrench,
    name: 'Only the tools you gave it',
    description:
      'Every agent carries an allow-list, down to individual tools. Mention a tool in the prompt and it switches itself on; nothing else is ever in reach.',
  },
  {
    icon: ShieldCheck,
    name: "It can't outrank you",
    description:
      'Access is snapshotted onto the published version and clamped by whoever published it. Run one on a colleague’s behalf and their access becomes a ceiling: delegation narrows, never widens.',
  },
  {
    icon: Zap,
    name: 'Seven ways to start',
    description:
      'A schedule, a record change, an installed app, an inbound webhook, an @mention, a ticket assignment, or a direct message.',
  },
]

/**
 * The procedure story: an authored document on the left, the run it produces on
 * the right. Chrome follows `platform/crm/_components/access-section.tsx` (muted
 * band, double `border-x` rail, hatch strip as the section-start marker) so the
 * two permission-shaped sections across the site rhyme.
 */
export default function AgentRunSection({ bordered = false }: AgentRunSectionProps) {
  return (
    <section className={cn('relative bg-muted/30', bordered && 'border-y border-foreground/10')}>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full border-b border-foreground/10 bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-15'
          />
          <div className='px-6 py-16 md:py-24'>
            <div className='mx-auto max-w-3xl text-center'>
              <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/60 px-3 py-1 text-xs'>
                <Settings2 className='size-3.5 text-indigo-500' />
                <span className='text-muted-foreground'>Procedures · Deterministic playbooks</span>
              </div>
              <h2 className='mt-6 text-balance text-4xl font-semibold md:text-5xl'>
                The agent doesn&apos;t decide the steps.
                <br />
                You do.
              </h2>
              <p className='mx-auto mt-4 text-balance text-lg text-muted-foreground'>
                A procedure is a document you write in plain language. Inline badges make it
                executable: tools, code, branches, and where it ends. Pick an agent to watch one
                run.
              </p>
            </div>

            <div className='mt-14 w-full'>
              <AgentRunIllustration />
            </div>

            <div className='mt-16 grid gap-x-6 gap-y-8 border-t pt-12 sm:grid-cols-3'>
              {capabilities.map((capability) => (
                <div key={capability.name} className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <capability.icon className='size-4 fill-foreground/10 text-foreground' />
                    <h3 className='text-sm font-medium'>{capability.name}</h3>
                  </div>
                  <p className='text-sm text-muted-foreground'>{capability.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

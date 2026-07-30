// apps/homepage/src/app/platform/ai/agents/_components/agent-roster-section.tsx

import { Play, ShieldCheck, Wrench, Zap } from 'lucide-react'
import { cn } from '~/lib/utils'
import { AGENT_CAST } from './agent-cast'
import { AgentPortraitCard } from './agent-portrait'

/**
 * The cast. Five faces, five jobs, five different ways of starting, before the
 * run illustration puts one of them to work.
 *
 * Knowledge keeper carries no procedure on purpose: an agent without one runs in
 * free-form persona mode, with no classifier call at all. It is also the only
 * read-only agent here, which makes the permissions point before the next
 * section states it.
 */
export default function AgentRosterSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Five hires. No onboarding.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            Each one gets a job, a set of tools, and an access level, the same three things you give
            a person. Then it starts itself.
          </p>
        </div>

        <ul className='mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
          {AGENT_CAST.map((agent) => (
            <li
              key={agent.id}
              className='flex flex-col overflow-hidden rounded-2xl border bg-card ring-1 ring-foreground/5'>
              <div className='px-3 pt-4'>
                <AgentPortraitCard agent={agent} />
              </div>

              <div className='flex flex-1 flex-col gap-3 px-4 pb-5'>
                <div>
                  <h3 className='font-medium text-foreground'>{agent.name}</h3>
                  <span
                    className={cn(
                      'mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                      agent.accent.chip
                    )}>
                    <Zap className='size-3' />
                    {agent.trigger}
                  </span>
                </div>

                <dl className='mt-auto space-y-1.5 border-t pt-3 text-[11px] text-muted-foreground'>
                  <div className='flex items-start gap-1.5'>
                    <Play className='mt-px size-3 shrink-0' />
                    <dd className={cn(!agent.procedure && 'italic')}>
                      {agent.procedure ?? 'No procedure'}
                    </dd>
                  </div>
                  <div className='flex items-start gap-1.5'>
                    <Wrench className='mt-px size-3 shrink-0' />
                    <dd>{agent.toolsets}</dd>
                  </div>
                  <div className='flex items-start gap-1.5'>
                    <ShieldCheck className='mt-px size-3 shrink-0' />
                    <dd>{agent.access}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ul>

        <p className='mx-auto mt-10 max-w-2xl text-balance text-center text-sm text-muted-foreground'>
          Not every agent needs a playbook. One with no procedure just answers, using the persona
          and the tools you gave it. No branching, no extra model call.
        </p>
      </div>
    </section>
  )
}

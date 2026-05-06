// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-personas.tsx

'use client'

import { useState } from 'react'
import { cn } from '~/lib/utils'
import { MockKopilotPromptStory } from '../../_mocks'
import { PERSONA_SCRIPTS, type PersonaId } from './kopilot-personas-scripts'

interface Persona {
  id: PersonaId
  label: string
  heading: string
  description: string
}

const personas: Persona[] = [
  {
    id: 'support',
    label: 'Support',
    heading: 'Resolve faster when every reply has full context.',
    description: 'Pull policy, order history, and prior tickets into a draft you can accept.',
  },
  {
    id: 'ops',
    label: 'Ops',
    heading: 'Spot patterns across hundreds of tickets at once.',
    description: 'Cluster repeated issues, surface root causes, and assign owners.',
  },
  {
    id: 'founders',
    label: 'Founders',
    heading: 'Run the business without leaving your inbox.',
    description: 'Daily briefs, churn-risk customers, and the next thing worth your time.',
  },
  {
    id: 'devs',
    label: 'Developers',
    heading: 'Ship faster with the workspace as an API.',
    description: 'Capabilities run actions, not just answers — entities, tasks, mail, knowledge.',
  },
]

export default function KopilotPersonas() {
  const [active, setActive] = useState(personas[0].id)
  const persona = personas.find((p) => p.id === active) ?? personas[0]

  return (
    <section className='relative @container border-foreground/10 border-b bg-background'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x '>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='px-6 pt-20 pb-12 md:pt-28 md:pb-16'>
            <h2 className='mx-auto max-w-2xl text-balance text-center text-4xl font-semibold text-muted-foreground md:text-5xl'>
              Simply powerful customer intelligence.
            </h2>

            <div className='mt-10 flex flex-wrap items-center justify-center gap-2'>
              {personas.map((p) => (
                <button
                  key={p.id}
                  type='button'
                  onClick={() => setActive(p.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition',
                    active === p.id
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-foreground/10 text-muted-foreground hover:border-foreground/30'
                  )}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className='border-t border-foreground/10 relative'>
            <div
              aria-hidden
              className='h-3 absolute w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
            />
            <div className='grid divide-foreground/10 max-lg:divide-y lg:grid-cols-2 lg:divide-x'>
              <div className='space-y-3 px-6 py-4 sm:py-16 md:py-20 flex justify-between flex-col'>
                <h3 className='text-balance text-2xl font-semibold md:text-3xl'>
                  {persona.heading}
                </h3>
                <p className='text-muted-foreground max-w-sm'>{persona.description}</p>
              </div>

              <div className='px-3 sm:px-6 py-4 sm:py-16 md:py-20'>
                <MockKopilotPromptStory key={persona.id} script={PERSONA_SCRIPTS[persona.id]} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

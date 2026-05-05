// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-personas.tsx

'use client'

import { useState } from 'react'
import { cn } from '~/lib/utils'
import { MockKopilotPrompt } from '../../_mocks'

interface Suggestion {
  field: string
  value: string
}

interface Persona {
  id: string
  label: string
  heading: string
  prompt: string
  description: string
  suggestions: Suggestion[]
}

const personas: Persona[] = [
  {
    id: 'support',
    label: 'Support',
    heading: 'Resolve faster when every reply has full context.',
    prompt: 'draft refund reply for order #4521',
    description: 'Pull policy, order history, and prior tickets into a draft you can accept.',
    suggestions: [
      { field: 'Suggested reply', value: 'Apologies for the delay. Refund of $89.00 issued...' },
      { field: 'Tag intent', value: 'Refund · Shipping delay' },
      { field: 'Update CSAT', value: 'At-risk' },
      { field: 'Link to KB', value: 'Refund policy (v3)' },
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    heading: 'Spot patterns across hundreds of tickets at once.',
    prompt: 'summarize this week’s negative feedback',
    description: 'Cluster repeated issues, surface root causes, and assign owners.',
    suggestions: [
      { field: 'Top theme', value: 'Late shipping (38 mentions)' },
      { field: 'Second theme', value: 'Missing items (12 mentions)' },
      { field: 'Suggested action', value: 'Escalate to fulfillment' },
      { field: 'Affected SKUs', value: '3 SKUs flagged' },
    ],
  },
  {
    id: 'founders',
    label: 'Founders',
    heading: 'Run the business without leaving your inbox.',
    prompt: 'how is support trending this month?',
    description: 'Daily briefs, churn-risk customers, and the next thing worth your time.',
    suggestions: [
      { field: 'Tickets this week', value: '142 (↑18%)' },
      { field: 'Avg first response', value: '4m 12s' },
      { field: 'Churn risk', value: '2 accounts flagged' },
      { field: 'Recommended next', value: 'Reply to Greenleaf' },
    ],
  },
  {
    id: 'devs',
    label: 'Developers',
    heading: 'Ship faster with the workspace as an API.',
    prompt: 'add a tag and assign to triage',
    description: 'Capabilities run actions, not just answers — entities, tasks, mail, knowledge.',
    suggestions: [
      { field: 'Run capability', value: 'tag.add(“bug”)' },
      { field: 'Run capability', value: 'ticket.assign(triage)' },
      { field: 'Run capability', value: 'task.create(...)' },
      { field: 'Audit log', value: '3 actions queued' },
    ],
  },
]

export default function KopilotPersonas() {
  const [active, setActive] = useState(personas[0].id)
  const persona = personas.find((p) => p.id === active) ?? personas[0]

  return (
    <section className='relative bg-background border-b border-foreground/10'>
      <div className='mx-auto max-w-5xl px-6 py-20 md:py-28'>
        <h2 className='mx-auto max-w-2xl text-balance text-center text-4xl font-semibold md:text-5xl text-muted-foreground'>
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

        <div className='mt-14 grid gap-12 lg:grid-cols-2'>
          <div className='space-y-3'>
            <h3 className='text-balance text-2xl font-semibold md:text-3xl'>{persona.heading}</h3>
            <p className='text-muted-foreground'>{persona.description}</p>
          </div>

          <MockKopilotPrompt
            key={persona.id}
            prompt={persona.prompt}
            result={{
              title: 'Suggestions',
              rows: persona.suggestions.map((s) => ({ ...s, accept: true })),
            }}
          />
        </div>
      </div>
    </section>
  )
}

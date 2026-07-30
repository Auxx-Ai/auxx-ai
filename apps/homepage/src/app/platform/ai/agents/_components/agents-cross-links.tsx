// apps/homepage/src/app/platform/ai/agents/_components/agents-cross-links.tsx

import { GitBranch, Library, Send, Sparkles, Ticket } from 'lucide-react'
import Link from 'next/link'

const links = [
  {
    icon: Sparkles,
    name: 'Kopilot',
    description: 'The same engine, driven by you instead of a trigger. It also builds the agents.',
    href: '/platform/ai/kopilot',
    tone: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: Library,
    name: 'Knowledge base',
    description: 'What an agent answers from, scoped per agent and searched at run time.',
    href: '/platform/knowledge-base',
    tone: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    icon: GitBranch,
    name: 'Workflow',
    description: 'For the deterministic parts. An AI node hands a turn to an agent mid-graph.',
    href: '/platform/workflow',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: Send,
    name: 'Sequences',
    description: 'Timed reminders that need no judgment. Cheaper than an agent, on purpose.',
    href: '/platform/sequences',
    tone: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Ticket,
    name: 'Ticketing',
    description: 'Where triage writes, where assignment fires, and where a handoff lands.',
    href: '/platform/ticketing',
    tone: 'text-teal-600 dark:text-teal-400',
  },
]

/** Cross-links to the platform pages an agent actually touches. */
export default function AgentsCrossLinks() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Agents don&apos;t run alone.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            They read the same records, answer from the same knowledge, and start off the same
            events as everything else in the workspace.
          </p>
        </div>

        <ul className='mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2'>
          {links.map((link, index) => (
            <li key={link.name}>
              <Link
                href={link.href}
                className='flex h-full items-start gap-3.5 rounded-xl border bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:shadow-sm hover:ring-foreground/15'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10'>
                  <link.icon className={`size-4 ${link.tone}`} />
                </div>
                <div className='space-y-0.5'>
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-xs text-muted-foreground'>
                      [{String(index + 1).padStart(2, '0')}]
                    </span>
                    <span className='font-medium text-foreground'>{link.name}</span>
                  </div>
                  <p className='text-sm text-muted-foreground'>{link.description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

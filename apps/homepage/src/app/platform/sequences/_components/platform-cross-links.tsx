// apps/homepage/src/app/platform/sequences/_components/platform-cross-links.tsx

import { BarChart3, Bot, GitBranch, MessagesSquare, Truck, Users } from 'lucide-react'
import Link from 'next/link'

const links = [
  {
    icon: GitBranch,
    name: 'Workflow',
    description: 'Every sequence compiles down to a workflow the engine runs and retries.',
    href: '/platform/workflow',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: Truck,
    name: 'Dispatch',
    description: 'Scheduled visits, en-route crews, and completed jobs are the events that enroll.',
    href: '/platform/dispatch',
    tone: 'text-orange-600 dark:text-orange-400',
  },
  {
    icon: Users,
    name: 'CRM',
    description: 'Recipients are real contacts, and the fields you merge in are their fields.',
    href: '/platform/crm',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: MessagesSquare,
    name: 'Messaging',
    description: 'Sends from a connected mailbox — and their reply lands in your shared inbox.',
    href: '/platform/messaging',
    tone: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Bot,
    name: 'Agents',
    description: 'When a reminder needs a decision instead of a timer, an agent takes it.',
    href: '/platform/ai/agents',
    tone: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: BarChart3,
    name: 'Reporting',
    description: 'Sequence activity reports alongside everything else in your dashboards.',
    href: '/platform/reporting',
    tone: 'text-sky-600 dark:text-sky-400',
  },
]

/** Cross-links to the platform pages a sequence actually touches. */
export default function PlatformCrossLinks() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Sequences don&apos;t run alone.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            They compile down to a workflow, enroll off dispatch and billing events, and report into
            the same dashboards as everything else.
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

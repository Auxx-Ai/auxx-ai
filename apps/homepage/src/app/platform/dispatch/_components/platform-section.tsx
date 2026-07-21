// apps/homepage/src/app/platform/dispatch/_components/platform-section.tsx

import { Bot, GitBranch, LineChart, Users } from 'lucide-react'
import Link from 'next/link'

const links = [
  {
    icon: Bot,
    name: 'Kopilot',
    description: 'Ask AI about any job, customer, or invoice.',
    href: '/platform/ai/kopilot',
    tone: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: GitBranch,
    name: 'Workflows',
    description: 'Record rules and automations on every status change.',
    href: '/platform/workflow',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: LineChart,
    name: 'Reporting',
    description: 'Dashboards over jobs, revenue, and crew utilization.',
    href: '/platform/reporting',
    tone: 'text-sky-600 dark:text-sky-400',
  },
  {
    icon: Users,
    name: 'CRM',
    description: 'Every work order hangs off a real contact and company.',
    href: '/platform/crm',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
]

export default function PlatformSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            It runs on the whole platform.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Dispatch isn't a silo — jobs share contacts, automations, dashboards, and AI with
            everything else in Auxx.
          </p>
        </div>
        <ul className='mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2'>
          {links.map((link) => (
            <li key={link.name}>
              <Link
                href={link.href}
                className='bg-card hover:ring-foreground/15 ring-foreground/10 flex items-start gap-3.5 rounded-xl border p-5 ring-1 transition-shadow hover:shadow-sm'>
                <div className='bg-background ring-foreground/10 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1'>
                  <link.icon className={`size-4 ${link.tone}`} />
                </div>
                <div className='space-y-0.5'>
                  <div className='text-foreground font-medium'>{link.name}</div>
                  <p className='text-muted-foreground text-sm'>{link.description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// apps/homepage/src/app/platform/crm/_components/platform-section.tsx

import { Bot, Database, GitBranch, LineChart, Send, Ticket } from 'lucide-react'
import Link from 'next/link'

const links = [
  {
    icon: Ticket,
    name: 'Ticketing',
    description: 'Every conversation lands on the contact it belongs to.',
    href: '/platform/ticketing',
    tone: 'text-orange-600 dark:text-orange-400',
  },
  {
    icon: Bot,
    name: 'Kopilot',
    description: 'Ask AI about any customer, order, or open ticket.',
    href: '/platform/ai/kopilot',
    tone: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: Send,
    name: 'Sequences',
    description: 'Follow-ups pinned to a date that already lives on the record.',
    href: '/platform/sequences',
    tone: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: GitBranch,
    name: 'Workflows',
    description: 'Record rules that fire the moment a field changes.',
    href: '/platform/workflow',
    tone: 'text-purple-600 dark:text-purple-400',
  },
  {
    icon: LineChart,
    name: 'Reporting',
    description: 'Dashboards over contacts, pipeline, and revenue.',
    href: '/platform/reporting',
    tone: 'text-sky-600 dark:text-sky-400',
  },
  {
    icon: Database,
    name: 'Data model',
    description: 'Custom objects and fields, without a migration.',
    href: '/platform/data-model',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
]

/**
 * Cross-links out of the CRM page. Follows `dispatch/_components/platform-section`
 * — same shape, CRM's own copy and link set (that one names Dispatch in its body
 * and links to CRM, so it can't be imported here).
 */
export default function PlatformSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Not a CRM bolted on the side.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Contacts and companies are the same records your inbox, your automations, and your
            dashboards already run on — one data model, not five that sync.
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

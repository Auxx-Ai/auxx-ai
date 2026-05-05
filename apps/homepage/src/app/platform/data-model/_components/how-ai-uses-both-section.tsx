// apps/homepage/src/app/platform/data-model/_components/how-ai-uses-both-section.tsx

import { Bot, MessageSquareReply, Search } from 'lucide-react'

const consumers = [
  {
    name: 'Kopilot',
    description: 'Cites articles and dataset chunks back to the user with links.',
    icon: Bot,
  },
  {
    name: 'Ticket AI replies',
    description: 'Drafts answers grounded in your KB and uploaded docs.',
    icon: MessageSquareReply,
  },
  {
    name: 'Self-serve search',
    description: 'Customers find answers in your portal before opening a ticket.',
    icon: Search,
  },
]

export default function HowAiUsesBothSection() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-10 px-6'>
              <div className='space-y-4'>
                <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                  How AI uses both
                </span>
                <h2 className='text-foreground text-balance text-4xl font-semibold md:w-2/3'>
                  One data model. Three places it shows up.
                </h2>
                <p className='text-muted-foreground max-w-2xl'>
                  Kopilot, ticket auto-replies, and your help portal all read the same KB articles
                  and dataset segments. Update once — every surface gets it.
                </p>
              </div>

              <ul className='grid gap-4 md:grid-cols-3'>
                {consumers.map((c) => (
                  <li
                    key={c.name}
                    className='border-foreground/5 bg-muted/25 rounded-xl border p-5'>
                    <c.icon className='text-foreground/70 size-5' />
                    <div className='mt-4 text-foreground font-medium'>{c.name}</div>
                    <p className='text-muted-foreground mt-1 text-sm'>{c.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

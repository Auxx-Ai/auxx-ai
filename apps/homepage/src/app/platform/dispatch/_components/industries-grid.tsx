// apps/homepage/src/app/platform/dispatch/_components/industries-grid.tsx

import { Bug, Thermometer, Wrench } from 'lucide-react'
import Link from 'next/link'

const industries = [
  {
    icon: Thermometer,
    name: 'HVAC',
    description: 'Equipment records, seasonal tune-ups, install quotes.',
    href: '/industries/hvac',
    tone: 'text-sky-600 dark:text-sky-400',
  },
  {
    icon: Wrench,
    name: 'Plumbing',
    description: "Same-day dispatch for the jobs that can't wait.",
    href: '/industries/plumbing',
    tone: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: Bug,
    name: 'Pest Control',
    description: 'Recurring treatments that schedule themselves.',
    href: '/industries/pest-control',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
]

export default function IndustriesGrid() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>Built for the trades.</h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            The same board, records, and invoicing — with the fields and rhythms of your trade.
          </p>
        </div>
        <ul className='mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-3'>
          {industries.map((industry) => (
            <li key={industry.name}>
              <Link
                href={industry.href}
                className='bg-card hover:ring-foreground/15 ring-foreground/10 flex h-full flex-col items-start gap-3 rounded-xl border p-5 ring-1 transition-shadow hover:shadow-sm'>
                <div className='bg-background ring-foreground/10 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1'>
                  <industry.icon className={`size-4 ${industry.tone}`} />
                </div>
                <div className='space-y-0.5'>
                  <div className='text-foreground font-medium'>{industry.name}</div>
                  <p className='text-muted-foreground text-sm'>{industry.description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className='text-muted-foreground mx-auto mt-8 max-w-4xl text-center text-sm'>
          More trades coming — electrical, cleaning, locksmith.
        </p>
      </div>
    </section>
  )
}

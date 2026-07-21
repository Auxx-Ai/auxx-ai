// apps/homepage/src/app/platform/dispatch/_components/money-section.tsx

import { CreditCard, FileText, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { MockMoneyStrip } from '../_mocks/money-mock'

const beats = [
  {
    icon: ShieldCheck,
    name: 'Quotes & approvals',
    description: 'Send a quote, get a clean customer approval before work starts.',
  },
  {
    icon: FileText,
    name: 'Invoices & deposits',
    description: 'Bill off the approved quote and collect a deposit up front.',
  },
  {
    icon: CreditCard,
    name: 'PDF documents & payments',
    description: 'Branded PDFs and online payment, built into the same record.',
  },
]

export default function MoneySection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Quote it. Invoice it. Get paid.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Quotes with approvals, invoices with deposits, branded PDFs and online payment — built
            into the same records.
          </p>
        </div>
        <MockMoneyStrip className='mx-auto mt-12 max-w-3xl' />
        <ul className='mx-auto mt-12 grid max-w-4xl gap-x-6 gap-y-8 sm:grid-cols-3'>
          {beats.map((beat) => (
            <li key={beat.name} className='space-y-2'>
              <beat.icon className='text-muted-foreground size-5' />
              <div className='text-foreground font-medium'>{beat.name}</div>
              <p className='text-muted-foreground text-sm'>{beat.description}</p>
            </li>
          ))}
        </ul>
        <p className='text-muted-foreground mt-12 text-center text-sm'>
          Just need an invoice?{' '}
          <Link href='/free-tools/invoice-generator' className='text-foreground hover:underline'>
            Try the free invoice generator →
          </Link>
        </p>
      </div>
    </section>
  )
}

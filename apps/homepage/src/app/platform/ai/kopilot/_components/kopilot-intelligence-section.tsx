// apps/homepage/src/app/platform/ai/kopilot/_components/kopilot-intelligence-section.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { Check, FileText, Lock, ShieldCheck } from 'lucide-react'
import { MockAppSidebar, MockBrowserChrome, MockKopilotWindow, MockMainPage } from '../../_mocks'

const sources = [
  { source: 'Ticket #4521', detail: 'Refund requested · 2d ago' },
  { source: 'KB · Refund policy', detail: 'v3 · published' },
  { source: 'Shopify · Order #4521', detail: 'Shipped · 7d late' },
  { source: 'Contact · Drew Houston', detail: 'VIP · 12 prior tickets' },
]

const suggestions = [
  { entity: 'Drew Houston', field: 'Update role', value: 'Head of IT' },
  { entity: 'Greenleaf', field: 'Funding raised', value: '$100M – $250M' },
  { entity: 'Order #4521', field: 'Update next step', value: 'Send tracking number' },
]

const intelligenceTurns = [
  { kind: 'user' as const, text: 'Summarize my open tickets' },
  {
    kind: 'tool' as const,
    title: 'Tickets',
    count: 8,
    headerLabel: '3 steps completed',
    items: [
      { code: 'RF', title: 'Request for information', subtitle: 'TKT-0003' },
      { code: 'GI', title: 'General inquiry about services', subtitle: 'TKT-0001' },
      { code: 'CI', title: 'Can I change my shipping address?', subtitle: 'TKT-0006' },
      { code: 'RP', title: 'Replace phone for Carolin Klooth', subtitle: 'TKT-0008' },
      { code: 'CI', title: 'Can I change my shipping address?', subtitle: 'TKT-0007' },
    ],
  },
]

export default function KopilotIntelligenceSection() {
  return (
    <section className='relative bg-background border-b border-foreground/10'>
      <div className='mx-auto max-w-6xl px-6 pt-24 pb-12'>
        <h2 className='mx-auto max-w-3xl text-balance text-center text-4xl font-semibold md:text-5xl'>
          Intelligence built for how you work and what you do.
        </h2>

        <div className='mt-16'>
          <MockBrowserChrome variant='compact'>
            <div className='grid grid-cols-[220px_1fr] min-h-[560px]'>
              <MockAppSidebar activeKey='kopilot' />
              <MockMainPage>
                <MockKopilotWindow
                  breadcrumb={{ trail: ['Chats'], title: 'Open Support Tickets Summary' }}
                  turns={intelligenceTurns}
                  composerPlaceholder='Ask Kopilot...'
                  modelLabel='GPT-5.4 Nano'
                  status='idle'
                />
              </MockMainPage>
            </div>
          </MockBrowserChrome>
        </div>
      </div>

      <div className='relative z-10 mx-auto max-w-6xl '>
        <div className=' @container pt-10 pb-24'>
          <div className='mx-auto w-full px-6'>
            <div className='relative overflow-hidden rounded-2xl p-6'>
              <RandomGradient colors={[...GRADIENT_PALETTES.aurora]} mode='mesh' animated />
              <div className='@max-4xl:max-w-sm @max-4xl:mx-auto @4xl:grid-cols-3 grid gap-6 *:p-6 relative z-10'>
                <RealInformationCard />
                <PermissionsCard />
                <SuggestionsCard />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function RealInformationCard() {
  return (
    <div className='bg-card/80 ring-foreground/5 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent/50 shadow-md shadow-black/5 ring-1'>
      <div>
        <FileText className='fill-foreground/10 mb-5 size-4' />
        <h3 className='text-foreground text-lg font-semibold'>
          Real information, not AI invention.
        </h3>
        <p className='text-muted-foreground mt-3'>
          Every answer is sourced from your actual{' '}
          <span className='text-foreground font-medium'>tickets, contacts, KB, and datasets</span>.
        </p>
      </div>
      <div className='bg-linear-to-b -m-8 flex flex-col justify-end from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-8'>
        <ul className='space-y-1.5'>
          {sources.map((s, i) => (
            <li
              key={i}
              className='flex items-center justify-between rounded-md border border-foreground/5 bg-background/70 px-3 py-2 text-xs backdrop-blur-sm'>
              <span className='text-foreground'>{s.source}</span>
              <span className='text-muted-foreground'>{s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function PermissionsCard() {
  return (
    <div className='bg-card/80 ring-foreground/5 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent shadow-md shadow-black/5 ring-1'>
      <div>
        <Lock className='fill-foreground/10 mb-5 size-4' />
        <h3 className='text-foreground text-lg font-semibold'>Your permissions, enforced.</h3>
        <p className='text-muted-foreground mt-3'>
          Kopilot follows your org and role permissions —{' '}
          <span className='text-foreground font-medium'>
            every user only sees what they're supposed to
          </span>
          .
        </p>
      </div>
      <div className='bg-linear-to-b -m-8 flex flex-col justify-end from-transparent via-purple-50 to-emerald-50 dark:via-purple-500/10 dark:to-emerald-500/10 p-8'>
        <div className='rounded-md border border-foreground/5 bg-background/70 p-3 text-xs backdrop-blur-sm'>
          <div className='flex items-center gap-2'>
            <ShieldCheck className='size-3.5 text-emerald-500' />
            <span className='text-foreground'>Scoped to organization</span>
          </div>
          <div className='mt-2 flex items-center gap-2'>
            <ShieldCheck className='size-3.5 text-emerald-500' />
            <span className='text-foreground'>Role-based field visibility</span>
          </div>
          <div className='mt-2 flex items-center gap-2'>
            <ShieldCheck className='size-3.5 text-emerald-500' />
            <span className='text-foreground'>Audited on every action</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SuggestionsCard() {
  return (
    <div className='bg-card/80 ring-foreground/5 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent/50 shadow-md shadow-black/5 ring-1'>
      <div>
        <Check className='fill-foreground/10 mb-5 size-4' />
        <h3 className='text-foreground text-lg font-semibold'>
          Intelligent suggestions. Human decisions.
        </h3>
        <p className='text-muted-foreground mt-3'>
          You're always in command —{' '}
          <span className='text-foreground font-medium'>approve, modify, or reject</span> any
          suggestion.
        </p>
      </div>
      <div className='bg-linear-to-b -m-8 flex flex-col justify-end from-transparent via-sky-50 to-indigo-50 dark:via-sky-500/10 dark:to-indigo-500/10 p-8'>
        <ul className='space-y-1.5'>
          {suggestions.map((s, i) => (
            <li
              key={i}
              className='grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-foreground/5 bg-background/70 px-3 py-2 text-xs backdrop-blur-sm'>
              <div>
                <div className='text-muted-foreground'>{s.field}</div>
                <div className='text-foreground'>{s.value}</div>
              </div>
              <span className='inline-flex items-center gap-1 rounded border border-foreground/10 bg-background px-1.5 py-0.5 text-[10px] text-foreground/80'>
                <Check className='size-2.5' /> Accept
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

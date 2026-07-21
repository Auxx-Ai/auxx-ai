// apps/homepage/src/app/platform/dispatch/_mocks/pipeline-cards.tsx

import { CheckCircle2, Clock, Phone } from 'lucide-react'
import { cn } from '~/lib/utils'

const CARD_CLASS =
  'bg-card ring-foreground/10 w-full rounded-xl border border-transparent ring-1 shadow-xl shadow-black/5 overflow-hidden'

const PILL_TONE_CLASS = {
  muted: 'bg-muted text-muted-foreground',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
} as const

function StatusPill({
  tone,
  children,
}: {
  tone: keyof typeof PILL_TONE_CLASS
  children: React.ReactNode
}) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', PILL_TONE_CLASS[tone])}>
      {children}
    </span>
  )
}

interface MockCardProps {
  className?: string
}

/** REQ-1187 — a phoned-in service request, still New. */
export function MockRequestCard({ className }: MockCardProps) {
  return (
    <div className={cn(CARD_CLASS, className)}>
      <div className='flex items-center justify-between gap-2 px-3 pt-3'>
        <span className='text-muted-foreground font-mono text-[10px]'>REQ-1187</span>
        <StatusPill tone='muted'>New</StatusPill>
      </div>
      <div className='px-3 pt-1.5'>
        <div className='text-foreground text-xs font-medium'>
          Water heater install — Nguyen residence
        </div>
      </div>
      <div className='text-muted-foreground border-border/60 mt-2 flex items-center gap-1.5 border-t px-3 py-2 text-[10px]'>
        <Phone className='size-3 shrink-0' />
        <span>Phone call</span>
        <span className='text-muted-foreground/50'>·</span>
        <Clock className='size-3 shrink-0' />
        <span>Requested Tue AM</span>
      </div>
    </div>
  )
}

/** Q-2051 — the approved quote for the same job, itemized. */
export function MockQuoteCard({ className }: MockCardProps) {
  return (
    <div className={cn(CARD_CLASS, className)}>
      <div className='flex items-center justify-between gap-2 px-3 pt-3'>
        <span className='text-muted-foreground font-mono text-[10px]'>Q-2051</span>
        <StatusPill tone='emerald'>Approved</StatusPill>
      </div>
      <div className='px-3 pt-1.5'>
        <div className='text-foreground text-lg font-semibold tracking-tight'>$1,840.00</div>
      </div>
      <div className='text-muted-foreground border-border/60 mt-2 space-y-1 border-t px-3 py-2 text-[10px]'>
        <div className='flex items-center justify-between'>
          <span>Water heater 50gal</span>
          <span>$1,420.00</span>
        </div>
        <div className='flex items-center justify-between'>
          <span>Labor</span>
          <span>$420.00</span>
        </div>
      </div>
    </div>
  )
}

/** WO-1042 — the scheduled work order, assigned to Dana K. */
export function MockJobCard({ className }: MockCardProps) {
  return (
    <div className={cn(CARD_CLASS, className)}>
      <div className='flex items-center justify-between gap-2 px-3 pt-3'>
        <span className='text-muted-foreground font-mono text-[10px]'>WO-1042</span>
        <StatusPill tone='sky'>Scheduled</StatusPill>
      </div>
      <div className='px-3 pt-1.5'>
        <div className='text-foreground text-xs font-medium'>
          Water heater install — Nguyen residence
        </div>
      </div>
      <div className='text-muted-foreground border-border/60 mt-2 flex items-center gap-2 border-t px-3 py-2 text-[10px]'>
        <span className='bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium'>
          DK
        </span>
        <span>Dana K.</span>
        <span className='text-muted-foreground/50'>·</span>
        <Clock className='size-3 shrink-0' />
        <span>Tue 9:00–12:00</span>
      </div>
    </div>
  )
}

/** INV-3007 — the paid invoice, deposit already applied. */
export function MockInvoiceCard({ className }: MockCardProps) {
  return (
    <div className={cn(CARD_CLASS, className)}>
      <div className='flex items-center justify-between gap-2 px-3 pt-3'>
        <span className='text-muted-foreground font-mono text-[10px]'>INV-3007</span>
        <StatusPill tone='emerald'>Paid</StatusPill>
      </div>
      <div className='px-3 pt-1.5'>
        <div className='text-foreground text-lg font-semibold tracking-tight'>$1,840.00</div>
      </div>
      <div className='text-muted-foreground border-border/60 mt-2 flex items-center gap-1.5 border-t px-3 py-2 text-[10px]'>
        <CheckCircle2 className='size-3 shrink-0 text-emerald-500' />
        <span>$460.00 deposit applied</span>
      </div>
    </div>
  )
}

// apps/homepage/src/app/platform/dispatch/_mocks/money-mock.tsx

import { Check, CreditCard } from 'lucide-react'
import { cn } from '~/lib/utils'

const PANEL_CLASS =
  'bg-card ring-foreground/10 flex-1 rounded-xl border border-transparent ring-1 shadow-xl shadow-black/5 overflow-hidden'

function PaidPill({ children }: { children: React.ReactNode }) {
  return (
    <span className='bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-full px-2 py-0.5 text-[10px] font-medium'>
      {children}
    </span>
  )
}

/** Quote → invoice → payment, side by side: the money half of the pipeline. */
export function MockMoneyStrip({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row', className)}>
      <div className={PANEL_CLASS}>
        <div className='flex items-center justify-between gap-2 px-3 pt-3'>
          <span className='text-muted-foreground font-mono text-[10px]'>Q-2051</span>
          <PaidPill>Approved</PaidPill>
        </div>
        <div className='text-foreground px-3 pt-1.5 text-lg font-semibold tracking-tight'>
          $1,840.00
        </div>
        <div className='border-border/60 mt-3 flex items-center gap-2 border-t px-3 py-3'>
          <div className='bg-muted/60 ring-border/60 flex size-9 shrink-0 flex-col justify-center gap-0.5 rounded px-1.5 ring-1'>
            <span className='bg-muted-foreground/30 h-0.5 w-full rounded-full' />
            <span className='bg-muted-foreground/30 h-0.5 w-3/4 rounded-full' />
            <span className='bg-muted-foreground/30 h-0.5 w-full rounded-full' />
            <span className='bg-muted-foreground/30 h-0.5 w-2/3 rounded-full' />
          </div>
          <span className='text-muted-foreground text-[10px]'>Customer-facing PDF</span>
        </div>
      </div>

      <div className={PANEL_CLASS}>
        <div className='px-3 pt-3'>
          <span className='text-muted-foreground font-mono text-[10px]'>INV-3007</span>
        </div>
        <div className='text-muted-foreground mt-2 space-y-1 px-3 text-[10px]'>
          <div className='flex items-center justify-between'>
            <span>Water heater 50gal</span>
            <span>$1,420.00</span>
          </div>
          <div className='flex items-center justify-between'>
            <span>Labor</span>
            <span>$420.00</span>
          </div>
        </div>
        <div className='border-border/60 mt-2 flex items-center justify-between border-t px-3 py-2 text-xs font-medium'>
          <span className='text-foreground'>Total</span>
          <span className='text-foreground'>$1,840.00</span>
        </div>
        <div className='text-muted-foreground border-border/60 flex items-center justify-between border-t px-3 py-2 text-[10px]'>
          <span>Deposit</span>
          <span>$460.00</span>
        </div>
      </div>

      <div
        className={cn(
          PANEL_CLASS,
          'flex flex-col items-center justify-center gap-2 px-3 py-6 text-center'
        )}>
        <span className='bg-emerald-500/15 flex size-9 items-center justify-center rounded-full'>
          <Check className='text-emerald-600 dark:text-emerald-400 size-4' />
        </span>
        <div className='text-foreground text-xs font-medium'>Payment received</div>
        <div className='text-muted-foreground flex items-center gap-1.5 text-[10px]'>
          <CreditCard className='size-3 shrink-0' />
          <span>•••• 4242</span>
        </div>
        <PaidPill>Paid</PaidPill>
      </div>
    </div>
  )
}

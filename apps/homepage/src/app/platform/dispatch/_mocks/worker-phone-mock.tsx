// apps/homepage/src/app/platform/dispatch/_mocks/worker-phone-mock.tsx

import { Camera, Check, Plus } from 'lucide-react'
import { cn } from '~/lib/utils'

interface AgendaItem {
  time: string
  job: string
  status: string
  tone: 'emerald' | 'amber' | 'sky'
  active?: boolean
}

const AGENDA: AgendaItem[] = [
  { time: '8:30', job: 'Furnace tune-up — Alder Grove HOA', status: 'Done', tone: 'emerald' },
  {
    time: '10:00',
    job: 'Water heater install — Nguyen residence',
    status: 'En route',
    tone: 'amber',
    active: true,
  },
  { time: '1:00', job: 'Drain clearing — Hilltop Cafe', status: 'Scheduled', tone: 'sky' },
]

const STATUS_CLASS: Record<AgendaItem['tone'], string> = {
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
}

const CHECKLIST = [
  { label: 'Water heater installed', done: true },
  { label: 'Area cleaned', done: true },
  { label: 'Customer walkthrough', done: false },
]

/**
 * A phone-frame mock of the worker's mobile schedule: an agenda of today's
 * visits, the active visit expanded with an advancing status button, a
 * quality checklist, and photo attachments.
 */
export function MockWorkerPhone({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto w-64 sm:w-72', className)}>
      <div className='border-foreground/10 bg-foreground/[0.03] rounded-[2rem] border p-1.5 shadow-xl shadow-black/10'>
        <div className='bg-card rounded-[1.5rem] pb-4'>
          <div className='flex justify-center pt-2.5'>
            <div className='bg-foreground/15 h-1 w-10 rounded-full' />
          </div>

          <div className='px-3.5 pt-3'>
            <div className='text-foreground text-sm font-semibold'>Today</div>
            <div className='text-muted-foreground text-[10px]'>Tue, Jul 21 · Dana K.</div>
          </div>

          <ul className='mt-3 space-y-1.5 px-3.5'>
            {AGENDA.map((item) => (
              <li
                key={item.job}
                className={cn(
                  'rounded-lg px-2 py-1.5',
                  item.active
                    ? 'bg-violet-500/[0.07] ring-violet-500/25 ring-1'
                    : 'text-muted-foreground'
                )}>
                <div className='flex items-center gap-2'>
                  <span className='text-muted-foreground w-9 shrink-0 text-[10px]'>
                    {item.time}
                  </span>
                  <span
                    className={cn(
                      'flex-1 truncate text-[11px]',
                      item.active ? 'text-foreground font-medium' : undefined
                    )}>
                    {item.job}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                      STATUS_CLASS[item.tone]
                    )}>
                    {item.status}
                  </span>
                </div>

                {item.active && (
                  <div className='mt-2.5 space-y-3'>
                    <div className='text-muted-foreground text-[10px]'>418 Alder Grove Ln</div>

                    <button
                      type='button'
                      className='bg-violet-500/90 w-full rounded-lg py-2 text-center text-[11px] font-medium text-white'>
                      Arrived on site →
                    </button>

                    <div className='space-y-1'>
                      {CHECKLIST.map((check) => (
                        <div key={check.label} className='flex items-center gap-1.5'>
                          <span
                            className={cn(
                              'flex size-3.5 shrink-0 items-center justify-center rounded-[4px]',
                              check.done
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'border-muted-foreground/40 border'
                            )}>
                            {check.done && <Check className='size-2.5' />}
                          </span>
                          <span
                            className={cn(
                              'text-[10px]',
                              check.done ? 'text-foreground' : 'text-muted-foreground'
                            )}>
                            {check.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className='flex gap-1.5'>
                      <div className='from-muted to-muted-foreground/20 relative flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br'>
                        <Camera className='text-background/70 size-3.5' />
                      </div>
                      <div className='from-muted to-muted-foreground/20 relative flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br'>
                        <Camera className='text-background/70 size-3.5' />
                      </div>
                      <div className='border-muted-foreground/30 text-muted-foreground/70 flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed'>
                        <Plus className='size-3' />
                        <span className='text-[8px]'>Photo</span>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// apps/homepage/src/app/platform/dispatch/_mocks/job-record-mock.tsx

import { Plus } from 'lucide-react'
import { cn } from '~/lib/utils'

interface FieldProps {
  label: string
  value?: string
  children?: React.ReactNode
}

function Field({ label, value, children }: FieldProps) {
  return (
    <div>
      <dt className='text-muted-foreground text-[10px]'>{label}</dt>
      <dd className='text-foreground mt-0.5 font-medium'>{children ?? value}</dd>
    </div>
  )
}

type TimelineTone = 'muted' | 'emerald' | 'sky' | 'hollow'

const TIMELINE: { label: string; tone: TimelineTone }[] = [
  { label: 'Request received', tone: 'muted' },
  { label: 'Quote Q-2051 approved', tone: 'emerald' },
  { label: 'Scheduled Tue 9:00', tone: 'sky' },
  { label: 'Visit', tone: 'hollow' },
]

const DOT_CLASS: Record<TimelineTone, string> = {
  muted: 'bg-muted-foreground/40',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  hollow: 'border-muted-foreground/40 bg-background border',
}

const TEXT_CLASS: Record<TimelineTone, string> = {
  muted: 'text-muted-foreground',
  emerald: 'text-foreground',
  sky: 'text-foreground',
  hollow: 'text-muted-foreground',
}

/**
 * A work-order detail record: header + status, a field grid, a compact visit
 * timeline, and custom-field chips — echoing the product's record detail panel.
 */
export function MockJobRecord({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-card ring-foreground/10 rounded-xl border border-transparent shadow-xl shadow-black/5 ring-1',
        'overflow-hidden',
        className
      )}>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
        <span className='truncate text-sm font-medium'>
          WO-1042 · Water heater install — Nguyen residence
        </span>
        <span className='bg-sky-500/15 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400'>
          Scheduled
        </span>
      </div>

      <dl className='grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-xs'>
        <Field label='Contact' value='Thanh Nguyen' />
        <Field label='Company' value='—' />
        <Field label='Address' value='418 Alder Grove Ln' />
        <Field label='Job type' value='One-off' />
        <Field label='Window' value='Tue 9:00–12:00' />
        <Field label='Assigned'>
          <span className='inline-flex items-center gap-1.5'>
            <span className='bg-emerald-500/15 flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-medium text-emerald-600 dark:text-emerald-400'>
              DK
            </span>
            Dana K.
          </span>
        </Field>
      </dl>

      <ol className='border-t px-4 py-4'>
        {TIMELINE.map((step, i) => (
          <li key={step.label} className='flex gap-2'>
            <div className='flex flex-col items-center'>
              <span className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[step.tone])} />
              {i < TIMELINE.length - 1 && <span className='bg-border w-px flex-1' />}
            </div>
            <span className={cn('pb-3 text-xs', TEXT_CLASS[step.tone])}>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className='flex flex-wrap items-center gap-1.5 border-t px-4 py-3'>
        <span className='border-border/70 bg-muted/40 text-muted-foreground rounded-full border px-2 py-1 text-[10px]'>
          Heater model
        </span>
        <span className='border-border/70 bg-muted/40 text-muted-foreground rounded-full border px-2 py-1 text-[10px]'>
          Permit #
        </span>
        <span className='border-border/70 text-muted-foreground/70 inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-[10px]'>
          <Plus className='size-2.5' />
          Add field
        </span>
      </div>
    </div>
  )
}

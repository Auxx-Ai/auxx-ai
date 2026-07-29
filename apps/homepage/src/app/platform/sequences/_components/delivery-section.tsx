// apps/homepage/src/app/platform/sequences/_components/delivery-section.tsx

import { Ban, Clock, MessagesSquare, Reply } from 'lucide-react'
import { cn } from '~/lib/utils'

const DAYS = [
  { label: 'Mon', business: true },
  { label: 'Tue', business: true },
  { label: 'Wed', business: true },
  { label: 'Thu', business: true },
  { label: 'Fri', business: true },
  { label: 'Sat', business: false },
  { label: 'Sun', business: false },
]

/** Rows of the hour axis, 0–24 mapped to percentages. */
const WINDOW_START = 8
const WINDOW_END = 20
const pct = (hour: number) => `${(hour / 24) * 100}%`

const guarantees = [
  {
    icon: Clock,
    name: 'Delivery window & timezone',
    description:
      'Pick the hours, pick the IANA timezone, and flip on business-days-only. Anything that comes due outside the window waits.',
  },
  {
    icon: MessagesSquare,
    name: 'One thread, not six',
    description:
      'Step one opens the thread; every later step replies into it. Your customer sees a conversation, not a pile of unrelated mail.',
  },
  {
    icon: Reply,
    name: 'Replies end it',
    description:
      'An inbound reply exits the run on the spot. Nobody gets nudged about an invoice they already answered.',
  },
  {
    icon: Ban,
    name: 'Unsubscribe means everywhere',
    description:
      'One click suppresses that address across the whole workspace — every sequence, now and later.',
  },
]

/** A week of send windows: lit inside the hours, hatched on non-business days. */
function DeliveryWindowIllustration() {
  return (
    <div aria-hidden className='rounded-2xl border bg-card p-5 ring-1 ring-foreground/5 sm:p-6'>
      <div className='flex items-baseline justify-between text-xs'>
        <span className='font-medium'>08:00 – 20:00</span>
        <span className='text-muted-foreground'>America/Los_Angeles · business days only</span>
      </div>

      <div className='mt-5 flex gap-2'>
        {/* Hour ticks */}
        <div className='flex w-8 shrink-0 flex-col justify-between pb-5 text-[9px] text-muted-foreground'>
          <span>00:00</span>
          <span>12:00</span>
          <span>24:00</span>
        </div>

        <div className='grid flex-1 grid-cols-7 gap-1.5'>
          {DAYS.map((day) => (
            <div key={day.label} className='flex flex-col items-center gap-1.5'>
              <div className='relative h-40 w-full overflow-hidden rounded-md bg-muted/60'>
                {day.business ? (
                  <div
                    className='absolute inset-x-0 rounded-md bg-gradient-to-b from-blue-500/70 to-blue-500/40'
                    style={{ top: pct(WINDOW_START), bottom: `${100 - (WINDOW_END / 24) * 100}%` }}
                  />
                ) : (
                  <div className='absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,var(--color-foreground)_4px,var(--color-foreground)_5px)] opacity-[0.08]' />
                )}
              </div>
              <span
                className={cn(
                  'text-[10px]',
                  day.business ? 'text-muted-foreground' : 'text-muted-foreground/50'
                )}>
                {day.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className='mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-[11px]'>
        <span className='inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-1 text-muted-foreground'>
          Came due Fri 11:14 PM
        </span>
        <span className='text-muted-foreground'>→</span>
        <span className='inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1 font-medium text-blue-600 dark:text-blue-400'>
          Sends Mon 8:00 AM
        </span>
      </div>
    </div>
  )
}

/**
 * The trust story for customer-facing mail: when it sends, how it threads, and
 * how it stops.
 */
export default function DeliverySection() {
  return (
    <section className='border-b bg-muted/30'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid items-center gap-12 lg:grid-cols-2 lg:gap-16'>
          <div>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              It won&apos;t email your customer at 11pm.
            </h2>
            <p className='mt-4 text-balance text-lg text-muted-foreground'>
              A delivery window, a timezone, and business days only. A step that comes due at
              midnight on a Friday waits for Monday morning — because that&apos;s when a person
              would have sent it.
            </p>
          </div>
          <DeliveryWindowIllustration />
        </div>

        <div className='mt-16 grid gap-x-6 gap-y-8 border-t pt-12 sm:grid-cols-2 lg:grid-cols-4'>
          {guarantees.map((guarantee) => (
            <div key={guarantee.name} className='space-y-2'>
              <div className='flex items-center gap-2'>
                <guarantee.icon className='size-4 fill-foreground/10 text-foreground' />
                <h3 className='text-sm font-medium'>{guarantee.name}</h3>
              </div>
              <p className='text-sm text-muted-foreground'>{guarantee.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// apps/homepage/src/app/platform/sequences/_components/templates-section.tsx

import { CalendarCheck, CalendarClock, Receipt, ThumbsUp, Truck, Zap } from 'lucide-react'
import { cn } from '~/lib/utils'

type Timing = { kind: 'now' | 'relative' | 'anchor'; label: string }

interface Template {
  name: string
  trigger: string
  icon: typeof Zap
  tone: string
  steps: { subject: string; timing: Timing }[]
}

/**
 * The five sequences seeded into every workspace. Names, triggers, subjects and
 * timings are transcribed from `packages/lib/src/sequences/seed-templates.ts` —
 * keep them in sync if the seed changes.
 */
const templates: Template[] = [
  {
    name: 'Visit reminders',
    trigger: 'Visit scheduled',
    icon: CalendarClock,
    tone: 'text-blue-500',
    steps: [
      { subject: 'Your visit is booked', timing: { kind: 'now', label: 'Right away' } },
      {
        subject: 'Reminder: your visit is coming up',
        timing: { kind: 'anchor', label: '2 days before the visit · 9:00 AM' },
      },
      {
        subject: "We'll see you today",
        timing: { kind: 'anchor', label: 'Same day as the visit · 7:30 AM' },
      },
    ],
  },
  {
    name: 'Invoice reminders',
    trigger: 'Invoice sent',
    icon: Receipt,
    tone: 'text-amber-500',
    steps: [
      {
        subject: 'Your invoice is due soon',
        timing: { kind: 'anchor', label: '2 days before the due date · 9:00 AM' },
      },
      {
        subject: 'Your invoice is overdue',
        timing: { kind: 'anchor', label: '3 days after the due date · 9:00 AM' },
      },
      {
        subject: 'Invoice still outstanding',
        timing: { kind: 'anchor', label: '10 days after the due date · 9:00 AM' },
      },
    ],
  },
  {
    name: 'Job follow-up',
    trigger: 'Job completed',
    icon: ThumbsUp,
    tone: 'text-emerald-500',
    steps: [
      { subject: 'Thank you!', timing: { kind: 'now', label: 'Right away' } },
      { subject: 'How did everything go?', timing: { kind: 'relative', label: '10 days later' } },
    ],
  },
  {
    name: 'On our way',
    trigger: 'Visit en route',
    icon: Truck,
    tone: 'text-indigo-500',
    steps: [{ subject: "We're on our way", timing: { kind: 'now', label: 'Right away' } }],
  },
  {
    name: 'Visit follow-up',
    trigger: 'Visit completed',
    icon: CalendarCheck,
    tone: 'text-purple-500',
    steps: [
      { subject: 'Thanks — see you next time', timing: { kind: 'now', label: 'Right away' } },
    ],
  },
]

/**
 * Anchored timings get a distinct pill from relative ones — the same visual
 * split the real `SequenceDelayPill` makes between its two modes.
 */
function TimingPill({ timing }: { timing: Timing }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        timing.kind === 'anchor'
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'border border-dashed border-foreground/20 text-muted-foreground'
      )}>
      {timing.label}
    </span>
  )
}

export default function TemplatesSection() {
  return (
    <section className='border-b bg-muted/30'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Five sequences, already written.
          </h2>
          <p className='mt-4 text-balance text-lg text-muted-foreground'>
            Every workspace ships with them, switched off. Read the emails, pick a mailbox, turn
            them on.
          </p>
        </div>

        <ul className='mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {templates.map((template) => (
            <li
              key={template.name}
              className='flex flex-col rounded-xl border bg-card p-5 ring-1 ring-foreground/5'>
              <div className='flex items-center gap-3'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10'>
                  <template.icon className={cn('size-4', template.tone)} />
                </div>
                <div className='min-w-0'>
                  <div className='truncate font-medium text-foreground'>{template.name}</div>
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <Zap className='size-3 text-amber-500' />
                    {template.trigger}
                  </div>
                </div>
              </div>

              <ol className='mt-4 space-y-2.5 border-t pt-4'>
                {template.steps.map((step, index) => (
                  <li key={step.subject} className='flex gap-2.5'>
                    <span className='mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-foreground text-[9px] font-semibold text-background'>
                      {index + 1}
                    </span>
                    <div className='min-w-0 space-y-1'>
                      <div className='text-sm leading-snug'>{step.subject}</div>
                      <TimingPill timing={step.timing} />
                    </div>
                  </li>
                ))}
              </ol>
            </li>
          ))}

          <li className='flex flex-col justify-center rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
            <p>
              Or write your own. A sequence is an ordered list of emails, a delay between each, and
              a mailbox to send from — nothing to wire up.
            </p>
          </li>
        </ul>
      </div>
    </section>
  )
}

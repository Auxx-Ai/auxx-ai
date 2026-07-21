// apps/homepage/src/app/platform/dispatch/_mocks/intake-dialog-mock.tsx

import { Phone, User } from 'lucide-react'
import { cn } from '~/lib/utils'

const FAKE_INPUT_CLASS =
  'bg-muted/50 ring-border/60 text-foreground rounded-md px-2 py-1.5 text-xs ring-1'

function FakeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1'>
      <div className='text-muted-foreground text-[10px] font-medium'>{label}</div>
      {children}
    </div>
  )
}

/** Fast-entry service request dialog: fake fields only, no interactivity. */
export function MockIntakeDialog({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'bg-card ring-foreground/10 w-full max-w-sm rounded-xl border border-transparent ring-1 shadow-xl shadow-black/5 overflow-hidden',
        className
      )}>
      <div className='border-border/60 flex items-center justify-between border-b px-4 py-3'>
        <span className='text-foreground text-sm font-medium'>New service request</span>
        <span className='text-muted-foreground/50 text-xs'>✕</span>
      </div>
      <div className='space-y-3 px-4 py-3'>
        <FakeField label='Contact'>
          <div className={cn(FAKE_INPUT_CLASS, 'flex items-center justify-between gap-2')}>
            <span className='flex items-center gap-1.5'>
              <User className='text-muted-foreground size-3 shrink-0' />
              Thanh Nguyen
            </span>
            <span className='bg-sky-500/15 text-sky-600 dark:text-sky-400 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium'>
              Contact
            </span>
          </div>
        </FakeField>
        <FakeField label='Phone'>
          <div className={cn(FAKE_INPUT_CLASS, 'flex items-center gap-1.5')}>
            <Phone className='text-muted-foreground size-3 shrink-0' />
            (503) 555-0148
          </div>
        </FakeField>
        <FakeField label='What needs doing'>
          <div className={cn(FAKE_INPUT_CLASS, 'space-y-0.5')}>
            <div>Old water heater is leaking, needs a full replacement —</div>
            <div>50 gal, same closet location.</div>
          </div>
        </FakeField>
        <FakeField label='Service address'>
          <div className={FAKE_INPUT_CLASS}>412 Alder Ct, Beaverton, OR</div>
        </FakeField>
        <FakeField label='Preferred window'>
          <div className='flex flex-wrap gap-1.5'>
            {['Mon AM', 'Tue AM'].map((slot) => (
              <span
                key={slot}
                className='bg-foreground text-background rounded-full px-2 py-0.5 text-[10px] font-medium'>
                {slot}
              </span>
            ))}
          </div>
        </FakeField>
      </div>
      <div className='border-border/60 flex items-center justify-end gap-2 border-t px-4 py-3'>
        <div className='text-muted-foreground rounded-md px-2.5 py-1.5 text-xs font-medium'>
          Save request
        </div>
        <div className='bg-foreground text-background rounded-md px-2.5 py-1.5 text-xs font-medium'>
          Convert to job
        </div>
      </div>
    </div>
  )
}

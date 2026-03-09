// apps/web/src/app/(website)/_components/features-3-cols/real-time-messaging-card.tsx
import { Workflow } from 'lucide-react'
import { TriggersIllustration } from './triggers-illustration'

// TriggersCard renders the messaging feature column.
export const TriggersCard = () => (
  <div className='bg-card ring-foreground/10 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent shadow-md shadow-black/5 ring-1'>
    <div>
      <Workflow className='fill-foreground/10 mb-5 size-4' />
      <h3 className='text-foreground text-lg font-semibold'>Triggers</h3>
      <p className='text-muted-foreground mt-3'>
        Trigger actions inside <span className='text-foreground font-medium'>auxx.Ai</span> or from
        any external input.
      </p>
    </div>
    <div className='bg-linear-to-b relative -m-8 flex flex-col items-end justify-center from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-10 pb-4'>
      <TriggersIllustration />
    </div>
  </div>
)

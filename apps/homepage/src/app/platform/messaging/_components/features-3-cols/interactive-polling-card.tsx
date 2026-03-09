// apps/web/src/app/(website)/_components/features-3-cols/interactive-polling-card.tsx
import { Vote } from 'lucide-react'
import { PollIllustration } from './poll-illustration'

// InteractivePollingCard renders the polling feature column.
export const InteractivePollingCard = () => (
  <div className='bg-card ring-foreground/10 grid grid-rows-[auto_1fr] space-y-12 overflow-hidden rounded-2xl border border-transparent shadow-md shadow-black/5 ring-1'>
    <div>
      <Vote className='fill-foreground/10 mb-5 size-4' />
      <h3 className='text-foreground text-lg font-semibold'>Human in the loop</h3>
      <p className='text-muted-foreground mt-3'>
        Use the <span className='text-foreground font-medium'>human in the loop</span> tool to
        review responses prior to sending.
      </p>
    </div>
    <div className='bg-linear-to-b -m-8 flex flex-col items-end justify-center from-transparent via-indigo-50 to-rose-50 dark:via-indigo-500/10 dark:to-rose-500/10 p-8'>
      <div className='w-full px-2'>
        <PollIllustration />
      </div>
    </div>
  </div>
)

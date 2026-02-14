import { AlertCircle, Clock, User } from 'lucide-react'
import { cn } from '~/lib/utils'

export const TicketPaperIllustration = ({ className }: { className?: string }) => {
  return (
    <div aria-hidden className='relative'>
      <div
        className={cn(
          'mask-b-from-65% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 after:borde group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border',
          className
        )}>
        <div className='bg-illustration ring-border-illustration relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
          {/* Ticket Header */}
          <div className='mb-6 flex items-start justify-between'>
            <div className='space-y-1'>
              <div className='flex items-center gap-2'>
                <div className='bg-red-500 text-white rounded-full p-1'>
                  <AlertCircle className='size-3' />
                </div>
                <span className='text-red-600 text-xs font-medium uppercase'>HIGH PRIORITY</span>
              </div>
              <div className='font-mono text-lg font-semibold'>#TSK-12345</div>
              <div className='text-xs text-muted-foreground'>Opened 2 hours ago</div>
            </div>
            <div className='flex items-center gap-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs'>
              <Clock className='size-3' />
              <span>In Progress</span>
            </div>
          </div>

          {/* Ticket Details */}
          <div className='space-y-3 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
            <div className='border-b pb-3'>
              <div className='text-sm font-medium mb-2'>Website not loading - urgent!</div>
              <div className='text-xs text-muted-foreground'>
                Our main website has been down for the past hour. Customers can't access our
                services...
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Customer:</span>
              <div className='flex items-center gap-2'>
                <User className='size-3 text-muted-foreground' />
                <span className='bg-border h-2 w-20 rounded-full' />
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Assigned:</span>
              <span className='bg-border h-2 w-16 rounded-full' />
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Category:</span>
              <div className='bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs w-fit'>
                Technical
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

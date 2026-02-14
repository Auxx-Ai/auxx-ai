import { AlertCircle, Clock, User } from 'lucide-react'
import { LogoIcon } from '~/components/logo'

export const TicketingHeroIllustration = () => {
  return (
    <div className='mask-radial-from-50% mask-radial-at-center mask-radial-to-[75%_50%] relative max-md:-mx-6'>
      <div className='grid grid-cols-5 items-center gap-4'>
        <div className='*:ring-border-illustration space-y-4 *:h-32 *:rounded-2xl *:ring-1'>
          <div></div>
          <div className='h-58! bg-card/50 origin-left scale-95'></div>
          <div></div>
        </div>
        <div className='col-span-3 space-y-4'>
          <div className='bg-card/50 ring-border-illustration flex h-32 origin-top scale-95 rounded-2xl p-6 ring-1'>
            <div className='mt-auto w-full space-y-1 text-sm [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
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
                <div className='bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs w-fit opacity-50'>
                  Technical
                </div>
              </div>
            </div>
          </div>
          <div className='relative'>
            <div className='bg-linear-to-r absolute inset-4 from-purple-500 via-emerald-500 to-blue-500 opacity-40 blur-2xl'></div>

            <div className='bg-card ring-border-illustration relative rounded-2xl p-6 shadow-xl ring-1'>
              <div className='mb-6 flex items-start justify-between'>
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <div className='bg-red-500 text-white rounded-full p-1'>
                      <AlertCircle className='size-3' />
                    </div>
                    <span className='text-red-600 text-xs font-medium uppercase'>
                      HIGH PRIORITY
                    </span>
                  </div>
                  <div className='font-mono text-lg font-semibold'>#TSK-12345</div>
                  <div className='text-xs text-muted-foreground'>Opened 2 hours ago</div>
                </div>
                <div className='flex items-center gap-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs'>
                  <Clock className='size-3' />
                  <span>In Progress</span>
                </div>
              </div>

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
          <div className='bg-card/50 ring-border-illustration h-32 origin-bottom scale-95 rounded-2xl p-6 ring-1'>
            <div className='mb-6 flex items-start justify-between'>
              <div className='space-y-0.5'>
                <LogoIcon uniColor className='*:stroke-foreground opacity-50 *:fill-transparent' />
                <div className='mt-4 font-mono text-xs'>High Priority</div>
                <div className='mt-1 -translate-x-1 font-mono text-2xl font-semibold'>#102002</div>
                <div className='text-xs font-medium'>Due today</div>
              </div>
            </div>
          </div>
        </div>
        <div className='*:ring-border-illustration space-y-4 *:h-32 *:rounded-2xl *:ring-1'>
          <div></div>
          <div className='h-58! bg-card/50 origin-right scale-95'></div>
          <div></div>
        </div>
      </div>
    </div>
  )
}

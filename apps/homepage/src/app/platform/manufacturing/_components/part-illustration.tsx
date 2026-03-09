import { AlertTriangle, Calendar, MapPin, Package } from 'lucide-react'
import { cn } from '~/lib/utils'

export const PartIllustration = ({ className }: { className?: string }) => {
  return (
    <div aria-hidden className='relative'>
      <div
        className={cn(
          'mask-b-from-65% dark:mask-b-from-80% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 after:borde group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border',
          className
        )}>
        <div className='bg-illustration ring-border-illustration relative z-10 overflow-hidden rounded-2xl border border-transparent p-6 text-sm shadow-xl shadow-black/10 ring-1'>
          {/* Part Header */}
          <div className='mb-6 flex items-start justify-between'>
            <div className='space-y-1'>
              <div className='flex items-center gap-2'>
                <div className='bg-blue-600 text-white rounded-lg p-1.5'>
                  <Package className='size-4' />
                </div>
                <span className='text-blue-600 text-xs font-medium uppercase'>ACTIVE PART</span>
              </div>
              <div className='font-mono text-lg font-semibold'>BRG-2024-001</div>
              <div className='text-xs text-muted-foreground'>Industrial Ball Bearing</div>
            </div>
            <div className='flex items-center gap-1 bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs'>
              <AlertTriangle className='size-3' />
              <span>Low Stock</span>
            </div>
          </div>

          {/* Part Details */}
          <div className='space-y-3 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
            <div className='border-b pb-3'>
              <div className='text-sm font-medium mb-2'>SKU-2024-BRG-001</div>
              <div className='text-xs text-muted-foreground'>
                High-precision ball bearing for industrial machinery. Critical component for
                Assembly Line A.
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Stock Level:</span>
              <div className='flex items-center gap-2'>
                <span className='text-orange-600 font-medium text-xs'>24 units</span>
                <div className='bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded text-xs'>
                  Below Min
                </div>
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Location:</span>
              <div className='flex items-center gap-1'>
                <MapPin className='size-3 text-muted-foreground' />
                <span className='text-xs'>Warehouse B - Aisle 3 - Shelf 2A</span>
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Last Ordered:</span>
              <div className='flex items-center gap-1'>
                <Calendar className='size-3 text-muted-foreground' />
                <span className='text-xs'>Jan 15, 2024</span>
              </div>
            </div>

            <div className='grid grid-cols-[auto_1fr] items-center gap-3'>
              <span className='text-muted-foreground text-xs'>Supplier:</span>
              <div className='bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs w-fit'>
                Precision Parts Inc.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const VendorIllustration = () => {
  return (
    <div
      aria-hidden
      className='mask-b-from-65% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
      <div className='bg-illustration ring-border-illustration relative z-10 rounded-2xl p-6 shadow-xl shadow-black/10 ring-1'>
        <div className='text-foreground font-medium'>
          <span className='bg-blue-100 px-2 py-1 rounded text-blue-900'>Precision Parts Inc.</span>
        </div>
        <div className='text-muted-foreground mt-0.5 text-sm'>
          Vendor performance metrics and delivery analytics
        </div>
        <div className='relative mb-4 mt-4 flex'>
          <div className='h-5 w-4/5 rounded-l-md bg-blue-500' />
          <div className='h-5 w-1/5 rounded-r-md border duration-300 [--stripes-color:theme(colors.zinc.300)] [background-image:linear-gradient(-45deg,var(--stripes-color)_25%,transparent_25%,transparent_50%,var(--stripes-color)_50%,var(--stripes-color)_75%,transparent_75%,transparent)] [background-size:5px_5px]' />
        </div>
        <div className='flex gap-4 border-b border-dashed pb-3'>
          <div className='flex-1'>
            <div className='text-foreground text-xl font-medium'>94%</div>
            <div className='text-muted-foreground text-sm'>On-Time Delivery</div>
          </div>
          <div className='flex-1'>
            <div className='text-foreground text-xl font-medium'>4.2★</div>
            <div className='text-muted-foreground text-sm'>Quality Score</div>
          </div>
        </div>
        <div className='mt-3 space-y-2'>
          <div className='grid grid-cols-[auto_1fr_auto] items-center gap-2'>
            <div className='size-1.5 rounded-full bg-green-500'></div>
            <div className='text-sm font-medium'>Standard Parts</div>
            <div className='text-muted-foreground text-xs'>2-3 days</div>
          </div>
          <div className='grid grid-cols-[auto_1fr_auto] items-center gap-2'>
            <div className='size-1.5 rounded-full bg-yellow-500'></div>
            <div className='text-sm font-medium'>Custom Parts</div>
            <div className='text-muted-foreground text-xs'>7-10 days</div>
          </div>
          <div className='grid grid-cols-[auto_1fr_auto] items-center gap-2'>
            <div className='size-1.5 rounded-full bg-blue-500'></div>
            <div className='text-sm font-medium'>Bulk Orders</div>
            <div className='text-muted-foreground text-xs'>14-21 days</div>
          </div>
        </div>
      </div>
    </div>
  )
}

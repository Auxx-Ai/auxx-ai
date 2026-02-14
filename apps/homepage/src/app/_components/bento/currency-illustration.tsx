import { Bitcoin, DollarSign, Euro, Signature } from 'lucide-react'

export const CurrencyIllustration = () => {
  return (
    <div aria-hidden className='flex -space-x-4'>
      <div className='bg-linear-to-b to-background w-16 translate-y-1 -rotate-12 space-y-2 rounded-md from-blue-200 from-25% to-75% p-2 shadow-md [--color-border:color-mix(in_oklab,var(--color-foreground)15%,transparent)]'>
        <div className='flex -translate-x-0.5 items-center gap-0.5 text-blue-900'>
          <Bitcoin className='size-3' />
          <span className='text-xs font-medium'>BTC</span>
        </div>
        <div className='space-y-1.5'>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
        </div>

        <div className='space-y-1.5'>
          <div className='bg-(--color-border) h-[3px] w-full rounded-full' />
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2/3 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-1/3 rounded-full' />
          </div>
        </div>

        <Signature className='ml-auto size-3' />
      </div>
      <div className='bg-linear-to-b to-background z-1 relative w-16 space-y-2 rounded-md from-red-200 from-25% to-75% p-2 shadow-md [--color-border:color-mix(in_oklab,var(--color-foreground)15%,transparent)]'>
        <div className='flex -translate-x-0.5 items-center gap-0.5 text-red-900'>
          <Euro className='size-3' />
          <span className='text-xs font-medium'>Euro</span>
        </div>
        <div className='space-y-1.5'>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
        </div>

        <div className='space-y-1.5'>
          <div className='bg-(--color-border) h-[3px] w-full rounded-full' />
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2/3 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-1/3 rounded-full' />
          </div>
        </div>

        <Signature className='ml-auto size-3' />
      </div>
      <div className='bg-linear-to-b to-background w-16 translate-y-1 rotate-12 space-y-2 rounded-md from-lime-200 from-25% to-75% p-2 shadow-md [--color-border:color-mix(in_oklab,var(--color-foreground)15%,transparent)]'>
        <div className='flex -translate-x-0.5 items-center gap-0.5 text-lime-900'>
          <DollarSign className='size-3' />
          <span className='text-xs font-medium'>USD</span>
        </div>
        <div className='space-y-1.5'>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2.5 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-6 rounded-full' />
          </div>
        </div>

        <div className='space-y-1.5'>
          <div className='bg-(--color-border) h-[3px] w-full rounded-full' />
          <div className='flex items-center gap-1'>
            <div className='bg-(--color-border) h-[3px] w-2/3 rounded-full' />
            <div className='bg-(--color-border) h-[3px] w-1/3 rounded-full' />
          </div>
        </div>

        <Signature className='ml-auto size-3' />
      </div>
    </div>
  )
}

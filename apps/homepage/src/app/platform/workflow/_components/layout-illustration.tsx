import { Table2 } from '@/app/_components/table2'

export const LayoutIllustration = () => (
  <div aria-hidden className='relative'>
    <div className='z-1 absolute -right-48 bottom-2 md:-right-4 md:bottom-6 md:left-[13rem] md:w-[calc(100%-12rem)]'>
      <Table2 className='max-w-full' />
    </div>

    <div className='mask-b-from-50% rounded-2xl border'>
      <div className='absolute inset-y-0 left-0 w-[12rem] border-r'>
        <div className='flex gap-1.5 px-4 pt-4'>
          <div className='bg-foreground/5 border-foreground/5 size-2 rounded-full border'></div>
          <div className='bg-foreground/5 border-foreground/5 size-2 rounded-full border'></div>
          <div className='bg-foreground/5 border-foreground/5 size-2 rounded-full border'></div>
        </div>
      </div>
      <div className='ml-auto w-[calc(100%-12rem)]'>
        <div className='h-11 border-b'></div>
        <div className='relative h-80'>
          <div className='absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--color-border),var(--color-border)_1px,transparent_1px,transparent_6px)] opacity-50'></div>
        </div>
      </div>
    </div>
  </div>
)

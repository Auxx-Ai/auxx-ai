// apps/homepage/src/app/platform/data-model/_components/surfaces/widget-hero.tsx

import { MessageCircle } from 'lucide-react'
import { PixelCanvas } from './pixel-canvas'

export function WidgetHero() {
  return (
    <>
      <PixelCanvas color='rgba(56, 189, 248, 0.7)' />
      <div className='absolute inset-x-4 bottom-0 top-28'>
        <div className='ring-foreground/10 bg-background absolute inset-0 overflow-hidden rounded-2xl shadow-xl ring-1'>
          <div className='border-foreground/10 flex items-center gap-2 border-b px-3 py-1.5'>
            <div className='flex gap-1'>
              <span className='size-1.5 rounded-full bg-rose-300' />
              <span className='size-1.5 rounded-full bg-amber-300' />
              <span className='size-1.5 rounded-full bg-emerald-300' />
            </div>
          </div>

          <div className='relative h-full bg-gradient-to-br from-sky-50 to-white p-3 dark:from-sky-950/30 dark:to-background'>
            <div className='flex items-center justify-between'>
              <span className='text-foreground text-[10px] font-bold'>STORE</span>
              <div className='flex gap-2'>
                <span className='text-foreground/60 text-[8px]'>Shop</span>
                <span className='text-foreground/60 text-[8px]'>About</span>
              </div>
            </div>

            <div className='mt-3 grid grid-cols-2 gap-2'>
              <div className='border-foreground/10 aspect-square rounded-md border bg-foreground/[0.03]' />
              <div className='space-y-1 pt-1'>
                <div className='h-1.5 w-3/4 rounded bg-foreground/20' />
                <div className='h-1.5 w-1/2 rounded bg-foreground/10' />
                <div className='h-2 w-1/3 rounded bg-foreground/30' />
                <div className='mt-2 h-3 rounded bg-foreground' />
              </div>
            </div>

            <div className='absolute bottom-3 right-3 w-[140px]'>
              <div className='ring-foreground/10 bg-background origin-bottom-right -translate-y-2 scale-95 overflow-hidden rounded-xl opacity-0 shadow-lg ring-1 transition-all duration-500 ease-out group-hover/card:translate-y-0 group-hover/card:scale-100 group-hover/card:opacity-100'>
                <div className='bg-sky-500 px-2 py-1.5 text-white'>
                  <div className='flex items-center gap-1'>
                    <MessageCircle className='size-2.5' />
                    <span className='text-[8px] font-semibold'>Acme Help</span>
                  </div>
                </div>
                <div className='space-y-1 p-2'>
                  <div className='text-foreground/60 text-[7px]'>Suggested:</div>
                  <div className='border-foreground/10 rounded border px-1.5 py-1'>
                    <span className='text-foreground/80 text-[8px]'>Return policy</span>
                  </div>
                  <div className='border-foreground/10 rounded border px-1.5 py-1'>
                    <span className='text-foreground/80 text-[8px]'>Shipping times</span>
                  </div>
                </div>
              </div>
              <div className='ml-auto mt-1 grid size-7 origin-center animate-[breathe_4s_ease-in-out_infinite] place-items-center rounded-full bg-sky-500 text-white shadow-md transition-transform duration-500 group-hover/card:scale-125'>
                <MessageCircle className='size-3.5' />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// apps/homepage/src/app/platform/data-model/_components/surfaces/serp-hero.tsx

import { Search } from 'lucide-react'

const grainSvg =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>"

function SerpMock() {
  return (
    <div className='ring-foreground/10 bg-background/95 absolute inset-0 overflow-hidden rounded-2xl shadow-xl ring-1 backdrop-blur'>
      <div className='border-foreground/10 flex items-center gap-2 border-b px-3 py-2'>
        <div className='flex gap-1'>
          <span className='size-2 rounded-full bg-rose-300' />
          <span className='size-2 rounded-full bg-amber-300' />
          <span className='size-2 rounded-full bg-emerald-300' />
        </div>
        <div className='border-foreground/10 ml-auto flex w-2/3 items-center gap-1.5 rounded-full border bg-foreground/[0.03] px-2 py-1'>
          <Search className='text-foreground/40 size-2.5' />
          <span className='text-foreground/40 truncate text-[7px]'>
            acme returns policy 30 days
          </span>
        </div>
      </div>

      <div className='space-y-3 p-3'>
        <div className='flex gap-2'>
          <span className='text-foreground/40 text-[8px]'>All</span>
          <span className='text-foreground/40 text-[8px]'>Images</span>
          <span className='text-foreground/40 text-[8px]'>Shopping</span>
          <span className='text-foreground/70 border-b-2 border-blue-500 pb-1 text-[8px] font-medium'>
            News
          </span>
        </div>

        <div className='ring-foreground/10 space-y-1 rounded-lg p-1.5 ring-1'>
          <div className='flex items-center gap-1'>
            <span className='size-3 rounded-full bg-orange-400' />
            <span className='text-foreground/60 text-[7px]'>help.acme.com › returns</span>
          </div>
          <div className='text-blue-600 dark:text-blue-400 text-[10px] font-medium underline-offset-2 group-hover/card:underline'>
            Returns Policy — Acme Help Center
          </div>
          <p className='text-foreground/70 text-[8px] leading-snug'>
            You can return any unworn item within{' '}
            <span className='font-semibold'>30 days of delivery</span>. Free return shipping for
            orders over $50…
          </p>

          <div className='border-foreground/10 mt-1 grid grid-cols-3 gap-1 border-t pt-1.5'>
            <div className='space-y-0.5'>
              <div className='text-foreground/40 text-[6px] uppercase'>Window</div>
              <div className='text-foreground text-[7px] font-medium'>30 days</div>
            </div>
            <div className='space-y-0.5'>
              <div className='text-foreground/40 text-[6px] uppercase'>Free over</div>
              <div className='text-foreground text-[7px] font-medium'>$50</div>
            </div>
            <div className='space-y-0.5'>
              <div className='text-foreground/40 text-[6px] uppercase'>Refund</div>
              <div className='text-foreground text-[7px] font-medium'>3-5 days</div>
            </div>
          </div>
        </div>

        <div className='space-y-1'>
          <div className='text-foreground/60 text-[7px]'>shop.acme.com › faq</div>
          <div className='text-blue-600/70 dark:text-blue-400/70 text-[9px]'>
            Frequently asked questions
          </div>
          <div className='h-1 w-full rounded bg-foreground/5' />
          <div className='h-1 w-2/3 rounded bg-foreground/5' />
        </div>
      </div>
    </div>
  )
}

export function SerpHero() {
  return (
    <>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_30%_120%,rgba(157,127,255,0.4),transparent_60%),radial-gradient(circle_at_80%_-20%,rgba(255,107,157,0.35),transparent_50%)]' />
      <div
        aria-hidden
        className='absolute inset-0 opacity-[0.08]'
        style={{
          backgroundImage: `url("${grainSvg}")`,
          backgroundSize: '160px 160px',
        }}
      />

      <div className='absolute inset-x-4 bottom-0 top-28' style={{ perspective: '800px' }}>
        <div className='absolute inset-0 transition-transform duration-500 ease-out [transform-style:preserve-3d] group-hover/card:[transform:scale(1.05)_translateZ(40px)]'>
          <SerpMock />

          <div className='pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 [mask-image:linear-gradient(90deg,transparent_0%,#000_45%,#000_55%,transparent_100%)] [mask-position:-250%_0] [mask-size:80%_100%] [mask-repeat:no-repeat] group-hover/card:opacity-100 group-hover/card:[animation:visor-wipe_0.9s_ease_forwards]' />
        </div>
      </div>
    </>
  )
}

// apps/homepage/src/app/platform/data-model/_components/surfaces/kopilot-hero.tsx

import { BookOpen, Wand2 } from 'lucide-react'
import { WaveCanvas } from './wave-canvas'

export function KopilotHero() {
  return (
    <>
      <WaveCanvas color='rgb(167, 139, 250)' />

      <div
        className='pointer-events-none absolute bottom-24 left-1/2 z-[3] size-[120px] -translate-x-1/2 transition-[transform] duration-500 group-hover/card:scale-125 group-hover/card:-translate-y-10'
        style={{ perspective: '600px' }}>
        <div className='relative size-full [transform-style:preserve-3d] animate-[spin-slow_10s_linear_infinite]'>
          {[
            { transform: 'translateZ(60px)', face: 'front' },
            { transform: 'rotateY(180deg) translateZ(60px)', face: 'back' },
            { transform: 'rotateY(90deg) translateZ(60px)', face: 'right' },
            { transform: 'rotateY(-90deg) translateZ(60px)', face: 'left' },
            { transform: 'rotateX(90deg) translateZ(60px)', face: 'top' },
            { transform: 'rotateX(-90deg) translateZ(60px)', face: 'bottom' },
          ].map((f) => (
            <div
              key={f.face}
              className='absolute inset-0 rounded-lg border border-violet-400/40 bg-gradient-to-br from-violet-300/30 to-violet-500/40 shadow-[inset_0_0_40px_rgba(167,139,250,0.4)] backdrop-blur-sm dark:from-violet-400/20 dark:to-violet-600/30'
              style={{ transform: f.transform }}
            />
          ))}
        </div>
      </div>

      <div className='absolute inset-x-4 bottom-0 top-28'>
        <div className='ring-foreground/10 bg-background absolute inset-0 overflow-hidden rounded-2xl shadow-xl ring-1'>
          <div className='border-foreground/10 flex items-center gap-2 border-b px-3 py-1.5'>
            <div className='flex gap-1'>
              <span className='size-1.5 rounded-full bg-rose-300' />
              <span className='size-1.5 rounded-full bg-amber-300' />
              <span className='size-1.5 rounded-full bg-emerald-300' />
            </div>
            <span className='text-foreground/40 text-[7px]'>Ticket #2841</span>
          </div>

          <div className='flex h-full'>
            <div className='flex-1 space-y-2 p-3'>
              <div className='space-y-1'>
                <div className='h-1 w-1/3 rounded bg-foreground/20' />
                <div className='h-1 w-2/3 rounded bg-foreground/10' />
                <div className='h-1 w-1/2 rounded bg-foreground/10' />
              </div>
              <div className='border-foreground/10 mt-2 rounded border bg-foreground/[0.02] p-2'>
                <div className='space-y-1'>
                  <div className='h-1 w-2/3 rounded bg-foreground/15' />
                  <div className='h-1 w-3/4 rounded bg-foreground/10' />
                  <div className='h-1 w-1/2 rounded bg-foreground/10' />
                </div>
              </div>
            </div>

            <div className='border-foreground/10 w-[140px] border-l bg-violet-50/40 p-2 dark:bg-violet-950/20'>
              <div className='flex items-center gap-1'>
                <span className='grid size-4 place-items-center rounded bg-violet-500 text-white'>
                  <Wand2 className='size-2.5' />
                </span>
                <span className='text-foreground text-[9px] font-semibold'>Kopilot</span>
              </div>

              <div className='mt-2 space-y-1.5'>
                <div className='text-foreground/50 text-[7px] uppercase tracking-wide'>
                  Suggested reply
                </div>
                <div className='ring-foreground/10 bg-background space-y-1 rounded-md p-1.5 ring-1'>
                  <div className='h-1 w-full rounded bg-foreground/15' />
                  <div className='h-1 w-3/4 rounded bg-foreground/15' />
                  <div className='h-1 w-5/6 rounded bg-foreground/10' />
                </div>

                <div className='text-foreground/50 mt-2 text-[7px] uppercase tracking-wide'>
                  Grounded in
                </div>
                <div className='ring-violet-500/30 bg-violet-500/5 flex translate-x-3 items-start gap-1 rounded p-1.5 opacity-0 ring-1 transition-all duration-500 group-hover/card:translate-x-0 group-hover/card:opacity-100'>
                  <BookOpen className='text-violet-600 dark:text-violet-400 mt-0.5 size-2.5 shrink-0' />
                  <div className='min-w-0 flex-1'>
                    <div className='text-foreground truncate text-[8px] font-medium'>
                      Returns policy
                    </div>
                    <div className='text-foreground/50 truncate text-[7px]'>
                      30-day window applies…
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

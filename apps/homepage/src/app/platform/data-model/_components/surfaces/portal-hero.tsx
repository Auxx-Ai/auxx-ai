// apps/homepage/src/app/platform/data-model/_components/surfaces/portal-hero.tsx

import { ChevronRight, Search } from 'lucide-react'
import { RippleCanvas } from './ripple-canvas'

export function PortalHero() {
  return (
    <>
      <RippleCanvas color='rgb(251, 146, 60)' />
      <div className='absolute inset-x-6 bottom-0 top-32 origin-bottom rotate-[-2deg] transition-transform duration-500 ease-out group-hover/card:translate-x-[-12px] group-hover/card:-rotate-1'>
        <div className='ring-foreground/10 bg-background absolute inset-x-0 top-0 h-[calc(100%+24px)] overflow-hidden rounded-2xl shadow-xl ring-1'>
          <div className='border-foreground/10 flex items-center gap-2 border-b px-3 py-2'>
            <div className='flex gap-1'>
              <span className='size-2 rounded-full bg-rose-300' />
              <span className='size-2 rounded-full bg-amber-300' />
              <span className='size-2 rounded-full bg-emerald-300' />
            </div>
            <div className='border-foreground/10 bg-foreground/5 mx-auto flex w-2/3 items-center gap-1 rounded border px-2 py-1'>
              <span className='text-foreground/40 text-[8px]'>help.acme.com</span>
            </div>
          </div>

          <div className='flex h-full flex-col px-4 pb-6 pt-3'>
            <div className='flex items-center gap-1.5'>
              <div className='size-4 rounded bg-orange-400' />
              <span className='text-foreground text-[10px] font-semibold'>Acme Help</span>
            </div>

            <div className='border-foreground/10 mt-3 flex items-center gap-1.5 rounded-md border bg-foreground/[0.03] px-2 py-1.5'>
              <Search className='text-foreground/40 size-3' />
              <span className='text-foreground/40 text-[9px]'>Search articles…</span>
            </div>

            <div className='mt-3 space-y-1'>
              {[
                { label: 'Getting started', count: 12, open: true },
                { label: 'Returns & refunds', count: 8 },
                { label: 'Shipping', count: 6 },
                { label: 'Account', count: 4 },
              ].map((cat) => (
                <div key={cat.label}>
                  <div className='flex items-center justify-between rounded px-1.5 py-1'>
                    <div className='flex items-center gap-1'>
                      <ChevronRight
                        className={`text-foreground/40 size-2.5 transition-transform ${
                          cat.open ? 'rotate-90' : ''
                        }`}
                      />
                      <span className='text-foreground/80 text-[9px] font-medium'>{cat.label}</span>
                    </div>
                    <span className='text-foreground/40 text-[8px]'>{cat.count}</span>
                  </div>
                  {cat.open && (
                    <div className='ml-3.5 space-y-0.5'>
                      {[
                        'How to set up your store',
                        'Connecting your domain',
                        'First-time guide',
                      ].map((a) => (
                        <div
                          key={a}
                          className='text-foreground/60 truncate rounded px-1.5 py-0.5 text-[9px] hover:bg-foreground/5'>
                          {a}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

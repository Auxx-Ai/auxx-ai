// apps/homepage/src/app/platform/data-model/_components/surfaces/auto-reply-hero.tsx

import { Sparkles } from 'lucide-react'

const articleSnippet = `# Returns policy

You can return any unworn item within 30 days
of delivery. Items must be unwashed, with all
tags attached.

## Free shipping
We cover return shipping for orders over $50.
Smaller orders pay a flat $5.95 label fee.

## Refunds
Refunds post to your original payment method
within 3-5 business days of receiving the item.

# Shipping

Standard ground delivery: 3-5 business days.
Express: 1-2 days. We ship to all 50 states.

`

export function AutoReplyHero() {
  return (
    <>
      <div className='pointer-events-none absolute inset-x-0 top-0 bottom-[42%] overflow-hidden opacity-30 transition-opacity duration-500 ease-out group-hover/card:opacity-100'>
        <div className='absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[#EDFDED] via-[#EDFDED]/80 to-transparent dark:from-[#1A2A20] dark:via-[#1A2A20]/80' />
        <div className='flex flex-col px-5 pt-12 [animation:scroll-code_25s_linear_infinite_paused] group-hover/card:[animation-play-state:running]'>
          {[0, 1].map((i) => (
            <pre
              key={i}
              className='m-0 whitespace-pre-wrap break-words pt-12 font-mono text-[11px] leading-[1.6] text-emerald-700/70 dark:text-emerald-300/60'>
              {articleSnippet}
              {articleSnippet}
              {articleSnippet}
            </pre>
          ))}
        </div>
      </div>

      <div className='absolute inset-x-5 bottom-5 transition-transform duration-500 ease-out group-hover/card:-translate-y-1 group-hover/card:scale-[1.02]'>
        <div
          data-theme='dark'
          className='border-foreground/10 bg-background/85 overflow-hidden rounded-2xl border shadow-2xl shadow-black/75 ring-1 ring-black backdrop-blur-lg'>
          <div className='border-foreground/10 flex items-center justify-between gap-2 border-b px-3 py-2'>
            <div className='flex items-center gap-1.5'>
              <span className='grid size-4 place-items-center rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'>
                <Sparkles className='size-2.5' />
              </span>
              <span className='text-foreground text-[9px] font-semibold'>AI auto-reply</span>
            </div>
            <span className='rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[7px] font-medium text-emerald-600 dark:text-emerald-400'>
              Sent
            </span>
          </div>

          <div className='space-y-2 p-3'>
            <div className='flex items-baseline justify-between'>
              <span className='text-foreground/50 text-[8px]'>To: sarah@gmail.com</span>
              <span className='text-foreground/40 text-[7px]'>2:14 PM</span>
            </div>
            <div className='text-foreground text-[10px] font-medium leading-tight'>
              Re: Question about returns
            </div>

            <div className='space-y-1.5 pt-1'>
              <p className='text-foreground/80 text-[9px] leading-relaxed'>
                Hi Sarah — yes, you can return any unworn item within{' '}
                <span className='border-b-2 border-emerald-400/60 font-medium'>
                  30 days of delivery
                </span>{' '}
                <sup className='text-emerald-600 dark:text-emerald-400 text-[7px] font-bold'>
                  [1]
                </sup>
                .
              </p>
              <p className='text-foreground/80 text-[9px] leading-relaxed'>
                We&apos;ll cover the return shipping for orders over{' '}
                <span className='border-b-2 border-emerald-400/60 font-medium'>$50</span>
                <sup className='text-emerald-600 dark:text-emerald-400 text-[7px] font-bold'>
                  [2]
                </sup>
                . Let me know if you want a label.
              </p>
            </div>

            <div className='space-y-1 pt-2'>
              <div className='text-foreground/40 text-[7px] font-medium uppercase tracking-wide'>
                Sources
              </div>
              <div className='border-foreground/10 flex items-center gap-1.5 rounded border bg-foreground/[0.02] px-1.5 py-1'>
                <span className='text-emerald-600 dark:text-emerald-400 text-[7px] font-bold'>
                  [1]
                </span>
                <span className='text-foreground/70 text-[8px]'>Returns policy</span>
              </div>
              <div className='border-foreground/10 flex items-center gap-1.5 rounded border bg-foreground/[0.02] px-1.5 py-1'>
                <span className='text-emerald-600 dark:text-emerald-400 text-[7px] font-bold'>
                  [2]
                </span>
                <span className='text-foreground/70 text-[8px]'>Shipping & costs</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

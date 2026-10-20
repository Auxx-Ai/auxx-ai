// apps/homepage/src/app/builder/_components/app-section.tsx

import { Check } from 'lucide-react'
import { TAPE_ACCENT, TapeMark } from '~/components/tape-mark'
import { cn } from '~/lib/utils'
import type { AppInfo } from '../_data/content'
import { AppShot } from './app-shot'

/** One app's section: its intro, then screenshot and text rows on alternating sides. */
export default function AppSection({ info, muted }: { info: AppInfo; muted?: boolean }) {
  return (
    <section id={info.anchor} className={cn('scroll-mt-24 border-b', muted && 'bg-muted/50')}>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <div className='inline-flex items-center gap-2'>
            <TapeMark app={info.app} className='size-7' />
            <span className='text-sm font-medium'>Auxx {info.name}</span>
          </div>
          <h2 className='mt-4 text-balance text-4xl font-semibold md:text-5xl'>{info.tagline}</h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>{info.intro}</p>
        </div>
        <div className='mt-16 space-y-20'>
          {info.rows.map((row, index) => (
            <div key={row.title} className='grid items-center gap-10 md:grid-cols-2 lg:gap-16'>
              <div className={cn('max-w-md', index % 2 === 1 && 'md:order-2')}>
                <span className='text-muted-foreground font-mono text-xs'>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className='mt-2 text-2xl font-semibold'>{row.title}</h3>
                <p className='text-muted-foreground mt-3'>{row.description}</p>
                <ul className='mt-6 space-y-2 text-sm'>
                  {row.bullets.map((bullet) => (
                    <li key={bullet} className='flex items-center gap-2'>
                      <Check className='size-4' style={{ color: TAPE_ACCENT[info.app] }} />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
              <AppShot app={info.app} shot={row.shot} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// apps/homepage/src/app/builder/_components/three-apps.tsx

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { TapeBand, TapeMark } from '~/components/tape-mark'
import { APPS } from '../_data/content'

/** The three apps of the product side by side, each linking to its section. */
export default function ThreeApps() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Three apps. One product.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            A design, its drawings and its estimate open together in one set. Use one app or all
            three: they pick up each other's work.
          </p>
        </div>
        <div className='mt-12 grid gap-4 md:grid-cols-3'>
          {APPS.map((app) => (
            <Link
              key={app.app}
              href={`#${app.anchor}`}
              className='bg-card ring-foreground/10 group flex flex-col overflow-hidden rounded-2xl ring-1 transition-shadow hover:shadow-lg'>
              <TapeBand apps={[app.app]} className='h-1.5' />
              <div className='flex flex-1 flex-col p-6'>
                <div className='flex items-center gap-3'>
                  <TapeMark app={app.app} className='size-9' />
                  <div>
                    <div className='text-foreground font-semibold'>Auxx {app.name}</div>
                    <div className='text-muted-foreground text-sm'>{app.tagline}</div>
                  </div>
                </div>
                <ul className='text-muted-foreground mt-6 flex-1 space-y-2 text-sm'>
                  {app.points.map((point) => (
                    <li key={point} className='flex gap-2'>
                      <span aria-hidden className='text-foreground/30'>
                        —
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
                <span className='text-foreground mt-6 inline-flex items-center gap-1 text-sm font-medium'>
                  More about {app.name}
                  <ArrowRight className='size-4 transition-transform group-hover:translate-x-0.5' />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

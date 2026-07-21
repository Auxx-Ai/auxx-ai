// apps/homepage/src/app/industries/_components/industry-features.tsx

import type { LucideIcon } from 'lucide-react'
import { Bell, Clipboard, File, Map as MapIcon, Repeat, Zap } from 'lucide-react'
import type { IndustryFeatureIcon, IndustryVertical } from '../_data/verticals'
import { IndustryFieldsMock } from './industry-fields-mock'

const ICONS: Record<IndustryFeatureIcon, LucideIcon> = {
  repeat: Repeat,
  zap: Zap,
  clipboard: Clipboard,
  map: MapIcon,
  file: File,
  bell: Bell,
}

export default function IndustryFeatures({ vertical }: { vertical: IndustryVertical }) {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Made for the way you work.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            The fields, quotes, and routes that match how {vertical.proseNameWithArticle} shop
            actually runs a day.
          </p>
        </div>
        <div className='mx-auto mt-12 grid max-w-5xl items-center gap-10 lg:grid-cols-2'>
          <ul className='space-y-8'>
            {vertical.featureEmphasis.map((feature) => {
              const Icon = ICONS[feature.icon]
              return (
                <li key={feature.title} className='space-y-2'>
                  <Icon className='text-muted-foreground size-5' />
                  <div className='text-foreground font-medium'>{feature.title}</div>
                  <p className='text-muted-foreground text-sm'>{feature.description}</p>
                </li>
              )
            })}
          </ul>
          <IndustryFieldsMock
            fields={vertical.sampleFields}
            className='w-full max-w-md lg:mx-0 mx-auto'
          />
        </div>
      </div>
    </section>
  )
}

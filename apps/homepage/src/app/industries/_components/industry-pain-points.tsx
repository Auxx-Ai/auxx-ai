// apps/homepage/src/app/industries/_components/industry-pain-points.tsx

import type { IndustryVertical } from '../_data/verticals'

export default function IndustryPainPoints({ vertical }: { vertical: IndustryVertical }) {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>Sound familiar?</h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            The day-to-day pains of running {vertical.proseNameWithArticle} operation on
            spreadsheets, sticky notes, and group texts.
          </p>
        </div>
        <ul className='mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3'>
          {vertical.painPoints.map((pain) => (
            <li
              key={pain.title}
              className='bg-card ring-foreground/10 rounded-xl border border-transparent p-5 ring-1'>
              <div className='text-foreground font-medium'>{pain.title}</div>
              <p className='text-muted-foreground mt-2 text-sm'>{pain.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

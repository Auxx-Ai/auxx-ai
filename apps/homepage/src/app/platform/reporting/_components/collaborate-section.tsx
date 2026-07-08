// apps/homepage/src/app/platform/reporting/_components/collaborate-section.tsx

import { MockDashboardGrid } from '../_mocks'

export default function CollaborateSection() {
  return (
    <section className='bg-muted/30 border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='grid items-center gap-12 lg:grid-cols-2'>
          <MockDashboardGrid variant='collaborate' className='max-lg:order-last' />
          <div className='lg:max-w-md lg:justify-self-end'>
            <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
              Publish once. Everyone sees it.
            </h2>
            <p className='text-muted-foreground mt-4 text-lg'>
              Edit a dashboard live without breaking what your team relies on. Your changes stay in
              a working draft until you hit Publish — then everyone gets the new version at once.
            </p>
            <p className='text-muted-foreground mt-4'>
              Changed your mind? Discard the draft and the published dashboard never knew. No broken
              charts in the Monday standup.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

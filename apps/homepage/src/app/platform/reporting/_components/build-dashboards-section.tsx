// apps/homepage/src/app/platform/reporting/_components/build-dashboards-section.tsx

import { GitBranch, LayoutGrid, PanelsTopLeft } from 'lucide-react'
import { MockDashboardGrid } from '../_mocks'

const beats = [
  {
    icon: LayoutGrid,
    name: 'Drag, drop, resize',
    description: 'Arrange widgets on a flexible grid that snaps into place.',
  },
  {
    icon: PanelsTopLeft,
    name: 'Multi-tab dashboards',
    description: 'One dashboard per audience — overview, team, AI — in tabs.',
  },
  {
    icon: GitBranch,
    name: 'Versioned publishing',
    description: 'Edit live, then Publish or Discard. Viewers only ever see the published version.',
  },
]

export default function BuildDashboardsSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Build a dashboard in minutes.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Compose KPIs, charts, and record lists into one screen your whole team opens every
            morning.
          </p>
        </div>
        <MockDashboardGrid className='mx-auto mt-12 max-w-3xl' />
        <ul className='mx-auto mt-12 grid max-w-4xl gap-x-6 gap-y-8 sm:grid-cols-3'>
          {beats.map((beat) => (
            <li key={beat.name} className='space-y-2'>
              <beat.icon className='text-muted-foreground size-5' />
              <div className='text-foreground font-medium'>{beat.name}</div>
              <p className='text-muted-foreground text-sm'>{beat.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

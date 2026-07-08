// apps/homepage/src/app/platform/reporting/_components/data-exploration-grid.tsx
'use client'

import { Filter, Layers, Paintbrush, TrendingUp } from 'lucide-react'
import {
  CONTACTS_BY_COMPANY,
  CSAT_TREND,
  MockBarChart,
  MockCard,
  MockDonut,
  MockGauge,
  MockKpiTile,
  MockLineChart,
  TICKETS_BY_TAG,
  TICKETS_PER_DAY,
} from '../_mocks'

const capabilities = [
  {
    icon: Layers,
    name: 'Group your way',
    description: 'Category plus a second series breakdown — team by channel, tag by status.',
  },
  {
    icon: Filter,
    name: 'Filter anything',
    description: 'The same condition builder you use everywhere else, on every widget.',
  },
  {
    icon: TrendingUp,
    name: 'Compare over time',
    description: 'KPI trends and date buckets — day, week, month — with deltas built in.',
  },
  {
    icon: Paintbrush,
    name: 'Format to match',
    description: 'Values render like their fields: currencies, durations, percentages.',
  },
]

const examples = [
  {
    title: 'Tickets created per day',
    chart: (
      <MockBarChart
        data={TICKETS_PER_DAY.map((d) => ({ name: d.day, value: d.value }))}
        className='h-36'
        showTooltip={false}
      />
    ),
  },
  {
    title: 'Avg resolution time',
    chart: (
      <MockKpiTile
        label='Across all channels'
        value={2.4}
        fractionDigits={1}
        suffix=' h'
        deltaLabel='▼ 23%'
      />
    ),
  },
  {
    title: 'Contacts per company',
    chart: (
      <MockBarChart
        data={CONTACTS_BY_COMPANY}
        horizontal
        label='Contacts'
        className='h-36'
        showTooltip={false}
      />
    ),
  },
  {
    title: 'AI-resolved rate',
    chart: <MockGauge value={58} label='of all tickets' />,
  },
  {
    title: 'CSAT trend',
    chart: (
      <MockLineChart
        data={CSAT_TREND}
        xKey='week'
        series={[{ key: 'score', label: 'CSAT', colorVar: 'report-c2' }]}
        className='h-36'
        showTooltip={false}
      />
    ),
  },
  {
    title: 'Tickets by tag',
    chart: (
      <MockDonut
        data={TICKETS_BY_TAG.map((t) => ({ key: t.tag, name: t.tag, value: t.count }))}
        showLegend={false}
        centerValue='131'
        centerLabel='tickets'
      />
    ),
  },
]

export default function DataExplorationGrid() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Powerful data exploration.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Report on any entity in your workspace — tickets, contacts, companies, even parts — with
            the fields you already track.
          </p>
        </div>

        <ul className='mx-auto mt-12 grid max-w-4xl gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4'>
          {capabilities.map((capability) => (
            <li key={capability.name} className='space-y-2'>
              <capability.icon className='text-muted-foreground size-5' />
              <div className='text-foreground font-medium'>{capability.name}</div>
              <p className='text-muted-foreground text-sm'>{capability.description}</p>
            </li>
          ))}
        </ul>

        <div className='mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {examples.map((example) => (
            <MockCard key={example.title} title={example.title}>
              <div className='mt-2 flex h-40 flex-col justify-center'>{example.chart}</div>
            </MockCard>
          ))}
        </div>
      </div>
    </section>
  )
}

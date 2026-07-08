// apps/homepage/src/app/platform/reporting/_components/reporting-hero-tiles.tsx
'use client'

import { motion, useReducedMotion } from 'motion/react'
import {
  AI_RESOLVED_KPI,
  MockBarChart,
  MockCard,
  MockKpiTile,
  MockLegend,
  MockLineChart,
  RESOLUTION_TIME,
  TICKETS_BY_TEAM,
} from '../_mocks'

/** The three floating dashboard tiles under the hero headline. */
export function ReportingHeroTiles() {
  const reducedMotion = useReducedMotion()

  const tiles = [
    <MockCard key='kpi' layered contentClassName='h-full'>
      <MockKpiTile
        label='AI-resolved this week'
        value={AI_RESOLVED_KPI.value}
        deltaLabel={AI_RESOLVED_KPI.deltaLabel}
        spark={AI_RESOLVED_KPI.spark}
      />
    </MockCard>,
    <MockCard
      key='line'
      layered
      title='Median resolution time'
      subtitle='Minutes to resolve · last 8 weeks'
      contentClassName='h-full'>
      <MockLineChart
        data={RESOLUTION_TIME}
        xKey='week'
        series={[
          { key: 'email', label: 'Email', colorVar: 'report-c1' },
          { key: 'chat', label: 'Chat', colorVar: 'report-c2' },
        ]}
        className='mt-3 h-24'
      />
      <MockLegend
        items={[
          { label: 'Email', colorVar: 'report-c1' },
          { label: 'Chat', colorVar: 'report-c2' },
        ]}
      />
    </MockCard>,
    <MockCard
      key='bar'
      layered
      title='Tickets by team'
      subtitle='Open tickets right now'
      contentClassName='h-full'>
      <MockBarChart data={TICKETS_BY_TEAM} horizontal className='mt-3 h-28' />
    </MockCard>,
  ]

  return (
    <div className='mx-auto mt-16 grid max-w-5xl items-stretch gap-4 text-left sm:grid-cols-2 lg:grid-cols-3'>
      {tiles.map((tile, i) => (
        <motion.div
          key={tile.key}
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10% 0px' }}
          transition={{ duration: 0.5, delay: i * 0.12 }}
          className='last:max-lg:hidden lg:even:-translate-y-3'>
          {tile}
        </motion.div>
      ))}
    </div>
  )
}

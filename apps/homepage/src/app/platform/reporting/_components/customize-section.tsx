// apps/homepage/src/app/platform/reporting/_components/customize-section.tsx
'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import {
  AI_IMPACT,
  AI_RATE_BY_CHANNEL,
  AI_RATE_BY_TAG,
  AI_RATE_BY_TEAM,
  CONFIG_OPTIONS,
  CONTACT_TREND,
  CONTACTS_BY_COMPANY,
  CONTACTS_BY_TAG,
  MockBarChart,
  MockCard,
  MockConfigPanel,
  MockDonut,
  MockGauge,
  MockKpiTile,
  MockLineChart,
  MockRecordList,
  type MockWidgetConfig,
  RECENT_CONTACTS,
  RECENT_TICKETS,
  TICKET_TREND,
  TICKET_TREND_BY_CHANNEL,
  TICKETS_BY_CHANNEL,
  TICKETS_BY_TAG_QUARTER,
  TICKETS_BY_TEAM,
} from '../_mocks'

const CATEGORY_LABELS: Record<string, string> = {
  team: 'team',
  channel: 'channel',
  tag: 'tag',
  company: 'company',
}

/** name/value split for the current source + metric + category */
function categoryData({ source, metric, category }: MockWidgetConfig) {
  if (metric === 'aiRate') {
    if (category === 'channel') return AI_RATE_BY_CHANNEL
    if (category === 'tag') return AI_RATE_BY_TAG
    return AI_RATE_BY_TEAM
  }
  if (source === 'contacts') {
    return category === 'tag' ? CONTACTS_BY_TAG : CONTACTS_BY_COMPANY
  }
  if (category === 'channel') return TICKETS_BY_CHANNEL
  if (category === 'tag') return TICKETS_BY_TAG_QUARTER
  return TICKETS_BY_TEAM
}

function previewTitle({ source, metric, category }: MockWidgetConfig) {
  if (metric === 'aiRate') return `AI-resolved rate by ${CATEGORY_LABELS[category]}`
  return `${source === 'contacts' ? 'Contacts' : 'Tickets'} by ${CATEGORY_LABELS[category]}`
}

function WidgetPreview({ config }: { config: MockWidgetConfig }) {
  const { source, metric, kind, series } = config
  const data = categoryData(config)
  const total = source === 'contacts' ? 402 : 625

  switch (kind) {
    case 'bar':
      return (
        <MockBarChart
          data={data}
          horizontal={config.category === 'company'}
          label={
            metric === 'aiRate' ? 'AI-resolved %' : source === 'contacts' ? 'Contacts' : 'Tickets'
          }
          className='h-48'
        />
      )
    case 'line': {
      if (metric === 'aiRate') {
        return (
          <MockLineChart
            data={AI_IMPACT}
            xKey='week'
            series={[{ key: 'rate', label: 'AI-resolved %', colorVar: 'report-c4' }]}
            showXAxis
            className='h-48'
          />
        )
      }
      if (source === 'tickets' && series === 'channel') {
        return (
          <MockLineChart
            data={TICKET_TREND_BY_CHANNEL}
            xKey='week'
            series={[
              { key: 'email', label: 'Email', colorVar: 'report-c1' },
              { key: 'chat', label: 'Chat', colorVar: 'report-c2' },
            ]}
            showXAxis
            className='h-48'
          />
        )
      }
      return (
        <MockLineChart
          data={source === 'contacts' ? CONTACT_TREND : TICKET_TREND}
          xKey='week'
          series={[
            {
              key: 'total',
              label: source === 'contacts' ? 'Contacts' : 'Tickets',
              colorVar: 'report-c1',
            },
          ]}
          showXAxis
          className='h-48'
        />
      )
    }
    case 'pie': {
      if (metric === 'aiRate') {
        return (
          <MockDonut
            data={[
              { key: 'ai', name: 'AI-resolved', value: 58 },
              { key: 'rest', name: 'Human-handled', value: 42 },
            ]}
            slotVars={['report-c4', 'report-rest']}
            centerValue='58%'
            centerLabel='AI-resolved'
          />
        )
      }
      // fold >4 slices into "Other" so slot colors never cycle
      const slices =
        data.length > 4
          ? [
              ...data.slice(0, 3),
              { name: 'Other', value: data.slice(3).reduce((sum, d) => sum + d.value, 0) },
            ]
          : data
      return (
        <MockDonut
          data={slices.map((d) => ({ key: d.name, name: d.name, value: d.value }))}
          centerValue={String(total)}
          centerLabel={source === 'contacts' ? 'contacts' : 'tickets'}
        />
      )
    }
    case 'kpi':
      return metric === 'aiRate' ? (
        <MockKpiTile
          label='AI-resolved this quarter'
          value={58}
          suffix='%'
          deltaLabel='▲ 6 pts'
          spark={AI_IMPACT.map((d) => ({ x: d.week, y: d.rate }))}
          className='py-4'
        />
      ) : (
        <MockKpiTile
          label={source === 'contacts' ? 'Contacts this quarter' : 'Tickets this quarter'}
          value={total}
          deltaLabel={source === 'contacts' ? '▲ 6%' : '▲ 9%'}
          spark={(source === 'contacts' ? CONTACT_TREND : TICKET_TREND).map((d) => ({
            x: d.week,
            y: d.total,
          }))}
          className='py-4'
        />
      )
    case 'gauge':
      return metric === 'aiRate' ? (
        <MockGauge value={58} label='of all tickets' className='py-2' />
      ) : (
        <MockGauge
          value={source === 'contacts' ? 67 : 78}
          label={source === 'contacts' ? 'of quarterly goal' : 'of weekly goal'}
          colorVar='report-c1'
          className='py-2'
        />
      )
    case 'list':
      return (
        <MockRecordList
          tickets={source === 'contacts' ? RECENT_CONTACTS : RECENT_TICKETS}
          className='py-2'
        />
      )
  }
}

export default function CustomizeSection() {
  const [config, setConfig] = useState<MockWidgetConfig>({
    source: 'tickets',
    metric: 'count',
    category: 'team',
    series: 'none',
    kind: 'bar',
  })
  const reducedMotion = useReducedMotion()

  const applyPatch = (patch: Partial<MockWidgetConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      // snap dependent fields to valid options when the source changes
      const options = CONFIG_OPTIONS[next.source]
      if (!options.metrics.some((m) => m.value === next.metric)) {
        next.metric = options.metrics[0].value
      }
      if (!options.categories.some((c) => c.value === next.category)) {
        next.category = options.categories[0].value
      }
      if (next.source !== 'tickets' || next.metric !== 'count') next.series = 'none'
      return next
    })
  }

  const subtitle =
    config.series === 'channel' && config.kind === 'line'
      ? 'Weekly volume · split by channel'
      : `Grouped by ${CATEGORY_LABELS[config.category]} · this quarter`

  return (
    <section className='bg-muted/30 border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Every chart, your way.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Pick a source, a metric, and a breakdown — then flip between six widget types until the
            data reads the way you think.
          </p>
        </div>
        <div className='mx-auto mt-12 grid max-w-4xl items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'>
          <div className='bg-card ring-border rounded-2xl p-5 shadow-sm ring-1'>
            <div className='text-muted-foreground mb-4 text-xs font-medium uppercase tracking-wide'>
              Widget settings
            </div>
            <MockConfigPanel config={config} onChange={applyPatch} />
          </div>
          <MockCard layered title={previewTitle(config)} subtitle={subtitle}>
            <AnimatePresence mode='wait' initial={false}>
              <motion.div
                key={`${config.kind}-${config.source}-${config.metric}-${config.category}-${config.series}`}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className='mt-3'>
                <WidgetPreview config={config} />
              </motion.div>
            </AnimatePresence>
          </MockCard>
        </div>
      </div>
    </section>
  )
}

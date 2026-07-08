// apps/homepage/src/app/platform/reporting/_components/featured-reports.tsx
'use client'

import {
  AI_IMPACT,
  CONTACTS_BY_COMPANY,
  MockBarChart,
  MockCard,
  MockDonut,
  MockLineChart,
  TICKET_STATUS,
} from '../_mocks'

const reports = [
  {
    eyebrow: 'Support Performance',
    title: 'How fast are we resolving?',
    caption: 'Resolved vs open vs escalated, straight from your ticket data.',
    chart: <MockDonut data={TICKET_STATUS} centerValue='68%' centerLabel='resolved' />,
  },
  {
    eyebrow: 'AI Impact',
    title: 'What is Kopilot handling?',
    caption: 'The share of tickets AI resolves end-to-end, week over week.',
    chart: (
      <MockLineChart
        data={AI_IMPACT}
        xKey='week'
        series={[{ key: 'rate', label: 'AI-resolved %', colorVar: 'report-c4' }]}
        showXAxis
        className='h-44'
      />
    ),
  },
  {
    eyebrow: 'Customer Health',
    title: 'Where are our contacts?',
    caption: 'Contacts grouped by company, tag, or any custom field.',
    chart: <MockBarChart data={CONTACTS_BY_COMPANY} horizontal label='Contacts' className='h-44' />,
  },
]

export default function FeaturedReports() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
            Answers to the questions you ask every week.
          </h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            Start from a report that already understands support and CRM data — then make it yours.
          </p>
        </div>
        <div className='mt-12 grid gap-6 md:grid-cols-3'>
          {reports.map((report) => (
            <div key={report.eyebrow} className='flex flex-col'>
              <div className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
                {report.eyebrow}
              </div>
              <h3 className='text-foreground mt-1 text-lg font-medium'>{report.title}</h3>
              <p className='text-muted-foreground mb-4 mt-1 text-sm'>{report.caption}</p>
              <MockCard className='mt-auto' contentClassName='min-h-52'>
                {report.chart}
              </MockCard>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// import { GanttChartIllustration } from '~/app/(website)/platform/workflow/_components/gantt-chart-illustration'

import { GanttChartIllustration } from '../../workflow/_components/gantt-chart-illustration'

// apps/web/src/app/(website)/platform/messaging/_components/ai-powered-section.tsx
export default function AiPoweredSection() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='mx-auto w-full max-w-5xl px-6 py-20'>
            <GanttChartIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}

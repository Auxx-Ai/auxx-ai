// apps/web/src/components/calls/ui/recording-summary.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { BookOpen, Lightbulb } from 'lucide-react'

export function RecordingSummary() {
  return (
    <div className='flex flex-col'>
      <Section title='Summary' icon={<BookOpen className='size-3.5' />} collapsible={false}>
        <div className='text-muted-foreground text-sm py-6 text-center'>
          Summary will appear here once the recording is processed.
        </div>
      </Section>
      <Section title='Insights' icon={<Lightbulb className='size-3.5' />} collapsible={false}>
        <div className='text-muted-foreground text-sm py-6 text-center'>
          Insights will appear here once the recording is processed.
        </div>
      </Section>
    </div>
  )
}

// apps/homepage/src/app/platform/dispatch/_components/pipeline-section.tsx

import { ChevronRight } from 'lucide-react'
import {
  MockInvoiceCard,
  MockJobCard,
  MockQuoteCard,
  MockRequestCard,
} from '../_mocks/pipeline-cards'

const stages = [
  { caption: 'Request', Card: MockRequestCard },
  { caption: 'Quote', Card: MockQuoteCard },
  { caption: 'Work order', Card: MockJobCard },
  { caption: 'Invoice', Card: MockInvoiceCard },
]

export default function PipelineSection() {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-6xl px-6 py-16 md:py-24'>
        <div className='mx-auto max-w-2xl text-center'>
          <h2 className='text-balance text-4xl font-semibold md:text-5xl'>From request to paid.</h2>
          <p className='text-muted-foreground mt-4 text-balance text-lg'>
            The whole field-service pipeline — request, quote, job, invoice — as linked records, not
            five apps.
          </p>
        </div>
        <div className='border-border/60 mx-auto mt-12 max-w-5xl border-l pl-4 lg:border-l-0 lg:pl-0'>
          <div className='flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-0'>
            {stages.map((stage, i) => (
              <div key={stage.caption} className='flex items-center gap-2 lg:flex-1'>
                <div className='flex-1 space-y-2'>
                  <stage.Card />
                  <div className='text-muted-foreground text-center text-xs font-medium'>
                    {stage.caption}
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight className='text-muted-foreground/40 hidden size-5 shrink-0 lg:block' />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

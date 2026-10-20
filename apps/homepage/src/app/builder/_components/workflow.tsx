// apps/homepage/src/app/builder/_components/workflow.tsx

import { ArrowRight } from 'lucide-react'
import { TapeMark } from '~/components/tape-mark'
import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { WORKFLOW } from '../_data/content'

/** How the three apps hand the job to each other, in the platform pages' how-it-works pattern. */
export default function Workflow() {
  return (
    <section id='workflow' className='border-foreground/10 relative scroll-mt-24 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />
          <div className='w-full px-6 py-24'>
            <div className='grid gap-8 lg:grid-cols-[0.9fr_1.1fr]'>
              <div className='space-y-4'>
                <Badge variant='outline' className='w-fit'>
                  How it works
                </Badge>
                <h2 className='text-pretty text-3xl font-semibold sm:text-4xl'>
                  From the first line to the quote
                </h2>
                <p className='text-muted-foreground text-base'>
                  Each app hands its work to the next. Change the drawing and the estimate shows you
                  what moved, and what it costs.
                </p>
                <p className='text-muted-foreground text-sm'>
                  <strong className='text-foreground font-medium'>For Auxx-Lift dealers:</strong>{' '}
                  design the customer's garage, choose Quote from design and send the quote.
                </p>
              </div>
              <div className='grid gap-4'>
                {WORKFLOW.map((step, index) => (
                  <Card
                    key={step.title}
                    className='border-border/60 flex flex-row items-center gap-4 rounded-3xl border p-6'>
                    <TapeMark app={step.app} className='size-10' />
                    <div className='flex-1'>
                      <div className='flex items-center justify-between'>
                        <div className='text-foreground text-sm font-semibold'>
                          <span className='text-muted-foreground mr-2 font-mono'>
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {step.title}
                        </div>
                        {index < WORKFLOW.length - 1 && (
                          <ArrowRight className='text-muted-foreground hidden h-4 w-4 md:block' />
                        )}
                      </div>
                      <p className='text-muted-foreground text-xs'>{step.description}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

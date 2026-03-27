// apps/homepage/src/app/platform/workflow/_components/workflow-content.tsx

import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'

/**
 * WorkflowContent component displays the visual workflow routing section
 * with description of intelligent routing capabilities for customer support
 */
export default function WorkflowContent() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Intelligent routing for{' '}
                <strong className='text-foreground font-semibold'>
                  automated customer support
                </strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='h-full w-full object-cover'
                  src={videoUrl('workflow-zoom.mp4')}
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Build{' '}
                  <strong className='text-foreground font-semibold'>
                    sophisticated conditional logic
                  </strong>{' '}
                  that routes tickets based on sentiment, urgency, product type, and customer
                  history—ensuring every inquiry gets the right response at the right time.
                </p>

                <p className='text-muted-foreground'>
                  Connect your workflows to{' '}
                  <strong className='text-foreground font-semibold'>
                    Shopify, email providers, and AI models
                  </strong>{' '}
                  seamlessly. Trigger actions like refunds, order tracking, or product
                  recommendations without writing a single line of code.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// apps/homepage/src/app/platform/integration/_components/integration-center-section.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'

/**
 * IntegrationCenterSection component displays the integration marketplace
 * showcasing the platform's extensive integration capabilities
 */
export default function IntegrationCenterSection() {
  return (
    <section className='relative overflow-hidden bg-background border-foreground/10 border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.ocean]} mode='mesh' animated />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <div className='aspect-3/2  mx-auto max-w-3xl'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='rounded-(--radius)'
                  src={videoUrl('app-install.mp4')}
                />
              </div>
              <div className='mx-auto max-w-xl space-y-6 text-center pt-10'>
                <h2 className='text-balance text-3xl font-medium lg:text-4xl'>
                  Connect everything your business needs
                </h2>
                <p className='text-muted-foreground text-balance text-lg'>
                  Seamlessly integrate with{' '}
                  <strong className='text-foreground font-semibold'>
                    Shopify, Gmail, Outlook, Slack, and dozens more
                  </strong>{' '}
                  tools. Add new integrations in one click to build workflows that work with your
                  entire tech stack.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

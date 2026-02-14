// apps/homepage/src/app/platform/integration/_components/integration-center-section.tsx
import Image from 'next/image'

/**
 * IntegrationCenterSection component displays the integration marketplace
 * showcasing the platform's extensive integration capabilities
 */
export default function IntegrationCenterSection() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-5xl px-6'>
              <div className='aspect-3/2 mask-radial-to-65% mx-auto max-w-2xl'>
                <Image
                  className='rounded-(--radius)'
                  src='/images/platform/integration/add-new-integration.png'
                  alt='Integration marketplace showing available connections'
                  width={1764}
                  height={1298}
                  loading='lazy'
                />
              </div>
              <div className='mx-auto max-w-xl space-y-6 text-center'>
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

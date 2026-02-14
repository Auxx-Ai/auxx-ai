// apps/homepage/src/app/platform/knowledge-base/_components/kb-center-section.tsx
import Image from 'next/image'

/**
 * KBCenterSection component displays the knowledge base builder interface
 * with description of customization options and branding capabilities
 */
export default function KBCenterSection() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Build a knowledge base that{' '}
                <strong className='text-foreground font-semibold'>
                  matches your brand perfectly
                </strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <Image
                  src='/images/platform/knowledge-base/kb-preview.png'
                  width={3070}
                  height={1994}
                  alt='Knowledge base customization interface with branding options'
                  className='h-full w-full object-cover'
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Create a fully{' '}
                  <strong className='text-foreground font-semibold'>
                    customizable self-service portal
                  </strong>{' '}
                  with your logo, colors, fonts, and domain. Organize articles into categories, add
                  rich media, and control visibility—all without technical expertise.
                </p>

                <p className='text-muted-foreground'>
                  Your knowledge base{' '}
                  <strong className='text-foreground font-semibold'>
                    powers AI-generated responses
                  </strong>{' '}
                  and helps customers find answers instantly. Track views, search queries, and
                  article performance to continuously improve your content.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

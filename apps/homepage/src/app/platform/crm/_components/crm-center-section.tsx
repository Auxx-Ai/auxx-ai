// apps/homepage/src/app/platform/crm/_components/crm-center-section.tsx
import { SectionTopFade } from '~/app/_components/main/section-top-fade'
import { ShaderGradientBg } from '~/app/_components/shader-gradient-bg'
import { AutoplayVideo } from '~/components/autoplay-video'
import { videoUrl } from '~/lib/cdn'

/**
 * CrmCenterSection component displays the CRM custom fields interface
 * with description of flexible data modeling and customization capabilities
 */
export default function CrmCenterSection() {
  return (
    <section className='relative overflow-hidden bg-background border-foreground/10 border-b'>
      <ShaderGradientBg preset='hero' palette='ocean' uniforms={{ timeSpeed: 0.7 }} />
      <SectionTopFade fromColor='color-mix(in oklab, var(--color-muted) 30%, var(--color-background))' />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Customize your CRM with{' '}
                <strong className='text-foreground font-semibold'>flexible custom fields</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <AutoplayVideo
                  autoPlay
                  loop
                  muted
                  className='h-full w-full object-cover'
                  src={videoUrl('crm-magic-fields.mp4')}
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Build a CRM that adapts to your business with{' '}
                  <strong className='text-foreground font-semibold'>unlimited custom fields</strong>
                  . Track any data point you need—from customer preferences to product categories to
                  subscription tiers—all with a few clicks.
                </p>

                <p className='text-muted-foreground'>
                  Create{' '}
                  <strong className='text-foreground font-semibold'>
                    text, number, date, dropdown, and multi-select fields
                  </strong>{' '}
                  that work seamlessly across contacts, orders, and tickets. Use custom fields in
                  workflows, filters, and AI responses for truly personalized automation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

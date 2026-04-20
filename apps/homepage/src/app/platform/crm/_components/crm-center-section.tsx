// apps/homepage/src/app/platform/crm/_components/crm-center-section.tsx
import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Image from 'next/image'

/**
 * CrmCenterSection component displays the CRM custom fields interface
 * with description of flexible data modeling and customization capabilities
 */
export default function CrmCenterSection() {
  return (
    <section className='relative overflow-hidden bg-background border-foreground/10 border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.ocean]} mode='mesh' animated />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Customize your CRM with{' '}
                <strong className='text-foreground font-semibold'>flexible custom fields</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <Image
                  src='/images/platform/crm/crm-custom-fields.png'
                  width={2362}
                  height={1998}
                  alt='CRM custom fields interface showing field configuration'
                  className='h-full w-full object-cover'
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

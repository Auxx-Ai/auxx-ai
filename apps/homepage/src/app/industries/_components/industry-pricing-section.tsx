// apps/homepage/src/app/industries/_components/industry-pricing-section.tsx

import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

export default function IndustryPricingSection({ proseName }: { proseName: string }) {
  return (
    <section className='border-b'>
      <div className='mx-auto max-w-3xl px-6 py-16 text-center md:py-24'>
        <h2 className='text-balance text-4xl font-semibold md:text-5xl'>
          Software that doesn’t cost a truck payment.
        </h2>
        <p className='text-muted-foreground mt-4 text-balance text-lg'>
          Simple plans, no enterprise onboarding fees, and nothing you need a sales call to
          understand. Start as a solo {proseName} operator and grow into a full fleet without
          switching software.
        </p>
        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button asChild size='sm' variant='outline'>
            <Link href='/pricing'>See pricing</Link>
          </Button>
          <Button asChild size='sm'>
            <Link href={config.urls.signup}>Start Free Trial</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

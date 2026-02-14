// apps/web/src/app/(website)/platform/integration/_components/integration-hero.tsx

import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { IntegrationsIllustration } from './integrations-illustration'

export default function IntegrationHero() {
  return (
    <section className='bg-muted border-b'>
      <div className='pt-32 pb-24 md:pt-40 lg:pt-48'>
        <div className='mx-auto max-w-5xl px-6'>
          <IntegrationsIllustration />

          <div className='mx-auto mt-20 max-w-2xl text-center'>
            <span className='text-primary bg-primary/5 border-primary/10 rounded-full border px-2 py-1 text-sm font-medium'>
              Integrations
            </span>
            <h1 className='mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl'>
              Connect all your preferred applications
            </h1>
            <p className='text-muted-foreground mx-auto mb-6 mt-4 max-w-xl text-balance text-lg'>
              With Auxx's integrations, connect with all your preferred applications and get your
              projects to the finish line faster.
            </p>

            <Button asChild>
              <Link href={config.urls.signup}>Browse Integrations</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Link from 'next/link'
import {
  ClaudeAI,
  Cloudflare,
  Gemini,
  GooglePaLM,
  Linear,
  MediaWiki,
  OpenAI,
  Replit,
  Vercel,
  VisualStudioCode,
} from '~/components/logos'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'
import { cn } from '~/lib/utils'

export default function IntegrationSection() {
  return (
    <section className='relative overflow-hidden border-b'>
      <RandomGradient colors={[...GRADIENT_PALETTES.ocean]} mode='mesh' animated />
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3 bg-background/20'>
        <div className='border-x bg-background/20'>
          <div
            aria-hidden
            className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5'
          />

          <section className=''>
            <div className=' py-24'>
              <div className='mx-auto max-w-5xl px-6'>
                <div aria-hidden className='space-y-3'>
                  <div className='flex flex-row-reverse justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex flex-row-reverse justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <IntegrationCard>
                      <MediaWiki className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>

                    <IntegrationCard>
                      <Replit className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>

                    <IntegrationCard>
                      <Vercel className='size-6' />
                    </IntegrationCard>
                    <IntegrationCard>
                      <Linear className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>

                    <IntegrationCard>
                      <VisualStudioCode className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <IntegrationCard>
                      <OpenAI className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <IntegrationCard>
                      <Cloudflare className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>

                    <IntegrationCard>
                      <ClaudeAI className='size-6' />
                    </IntegrationCard>
                    <IntegrationCard>
                      <Gemini className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <IntegrationCard>
                      <GooglePaLM className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <IntegrationCard>
                      <MediaWiki className='size-6' />
                    </IntegrationCard>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                  <div className='flex flex-row-reverse justify-center gap-3'>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                    <div className='bg-black/40 size-11 rounded-full border border-black/10'></div>
                  </div>
                </div>
                <div className='mx-auto mt-12 max-w-lg text-center'>
                  <h2 className='text-balance text-3xl font-semibold md:text-4xl'>
                    Seamless Integration with your favorite Tools
                  </h2>
                  <p className='text-muted-foreground mb-6 mt-4 text-balance'>
                    Connect seamlessly with popular platforms and services to enhance your workflow.
                  </p>

                  <Button size='lg' asChild>
                    <Link href={config.urls.signup}>Get Started</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

const IntegrationCard = ({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) => {
  return (
    <div
      className={cn(
        'bg-background/70 ring-foreground/10 flex aspect-square size-11 rounded-full border border-transparent shadow-md ring-1 *:m-auto *:size-5',
        className
      )}>
      {children}
    </div>
  )
}

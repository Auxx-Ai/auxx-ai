import {
  OpenAI,
  ClaudeAI,
  Cloudflare,
  Linear,
  Gemini,
  Replit,
  GooglePaLM,
  MediaWiki,
  Vercel,
  VisualStudioCode,
} from '~/components/logos'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import Link from 'next/link'

export default function IntegrationSection() {
  return (
    <section className="border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />

          <section className="">
            <div className="bg-muted/50 py-24">
              <div className="mx-auto max-w-5xl px-6">
                <div aria-hidden className="space-y-3">
                  <div className="flex flex-row-reverse justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex flex-row-reverse justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <IntegrationCard>
                      <MediaWiki className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>

                    <IntegrationCard>
                      <Replit className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>

                    <IntegrationCard>
                      <Vercel className="size-6" />
                    </IntegrationCard>
                    <IntegrationCard>
                      <Linear className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>

                    <IntegrationCard>
                      <VisualStudioCode className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <IntegrationCard>
                      <OpenAI className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <IntegrationCard>
                      <Cloudflare className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>

                    <IntegrationCard>
                      <ClaudeAI className="size-6" />
                    </IntegrationCard>
                    <IntegrationCard>
                      <Gemini className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <IntegrationCard>
                      <GooglePaLM className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <IntegrationCard>
                      <MediaWiki className="size-6" />
                    </IntegrationCard>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                  <div className="flex flex-row-reverse justify-center gap-3">
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                    <div className="bg-muted size-11 rounded-full border"></div>
                  </div>
                </div>
                <div className="mx-auto mt-12 max-w-lg text-center">
                  <h2 className="text-balance text-3xl font-semibold md:text-4xl">
                    Seamless Integration with your favorite Tools
                  </h2>
                  <p className="text-muted-foreground mb-6 mt-4 text-balance">
                    Connect seamlessly with popular platforms and services to enhance your workflow.
                  </p>

                  <Button variant="outline" size="sm" asChild>
                    <Link href="#">Get Started</Link>
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
        'bg-background ring-foreground/10 flex aspect-square size-11 rounded-full border border-transparent shadow-md ring-1 *:m-auto *:size-5',
        className
      )}>
      {children}
    </div>
  )
}

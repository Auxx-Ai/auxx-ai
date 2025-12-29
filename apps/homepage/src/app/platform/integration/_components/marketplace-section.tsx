// apps/web/src/app/(website)/platform/integration/_components/marketplace-section.tsx
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import Link from 'next/link'
import {
  Cloudflare,
  Gemini,
  ClaudeAI,
  OpenAI,
  VisualStudioCode as VSCode,
  Vercel,
  Gmail,
  Outlook,
  Facebook,
  Instagram,
  GoogleDrive,
  Dropbox,
} from '~/components/logos'
import { config } from '~/lib/config'

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
        'bg-background ring-foreground/10 flex aspect-square size-full rounded-lg border border-transparent shadow ring-1 *:m-auto *:size-5',
        className
      )}>
      {children}
    </div>
  )
}

const IntegrationsGroup = ({
  children,
  label,
  className,
}: {
  children?: React.ReactNode
  label?: string
  className?: string
}) => {
  return (
    <div
      className={cn(
        'ring-foreground/5 relative z-20 col-span-2 row-span-2 grid grid-rows-subgrid gap-1.5 self-center rounded-2xl border border-transparent bg-zinc-50 p-2 shadow ring-1',
        className
      )}>
      <span className="text-muted-foreground block self-center text-balance text-center text-sm">
        {label}
      </span>
      {children}
    </div>
  )
}

export default function MarketplaceSection() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div
            aria-hidden
            className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5"
          />
          <section className="bg-background">
            <div className="bg-muted @container py-24">
              <div className="mx-auto max-w-5xl px-6">
                <div className="mx-auto max-w-xl text-center">
                  <h2 className="text-balance text-3xl font-semibold md:text-5xl md:tracking-tight">
                    Seamless Integration
                  </h2>
                  <p className="text-muted-foreground mb-6 mt-4 text-balance text-lg">
                    Seamlessly integrate with over 200+ tools and platforms to streamline your
                    workflow and boost productivity.
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={config.urls.signup}>Get Started</Link>
                  </Button>
                </div>
                <div className="@max-xl:max-w-xs @xl:grid-cols-9 relative mx-auto mt-12 grid max-w-2xl grid-cols-4 gap-4">
                  <div
                    aria-hidden
                    className="mask-radial-to-85% absolute inset-x-0 inset-y-4 m-auto bg-[linear-gradient(to_right,var(--color-black)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-black)_1px,transparent_1px)] bg-[size:12px_12px] opacity-5"
                  />
                  <div
                    aria-hidden
                    className="mask-radial-to-85% translate-[0.5px] absolute inset-x-6 inset-y-4 m-auto bg-[radial-gradient(var(--color-black)_1px,transparent_1px)] opacity-25 [background-size:24px_24px]"
                  />

                  <IntegrationsGroup label="LLMs" className="@max-xl:row-start-3">
                    <div className="grid grid-cols-2 gap-2">
                      <IntegrationCard className="">
                        <OpenAI />
                      </IntegrationCard>
                      <IntegrationCard className="">
                        <ClaudeAI />
                      </IntegrationCard>
                    </div>
                  </IntegrationsGroup>

                  <div aria-hidden className="@max-xl:hidden" />

                  <IntegrationsGroup
                    label="Messaging"
                    className="@max-xl:col-span-4 @max-xl:w-3/4 @max-xl:row-start-1 @max-xl:place-self-center col-span-3">
                    <div className="grid grid-cols-4 gap-2">
                      <IntegrationCard>
                        <Gmail />
                      </IntegrationCard>
                      <IntegrationCard className="">
                        <Outlook />
                      </IntegrationCard>
                      <IntegrationCard className="">
                        <Facebook />
                      </IntegrationCard>

                      <IntegrationCard className="">
                        <Instagram />
                      </IntegrationCard>
                    </div>
                  </IntegrationsGroup>

                  <div aria-hidden className="@max-xl:hidden" />

                  <IntegrationsGroup label="Storage">
                    <div className="grid grid-cols-2 gap-2">
                      <IntegrationCard className="">
                        <GoogleDrive className="!w-7" />
                      </IntegrationCard>
                      <IntegrationCard className="">
                        <Dropbox />
                      </IntegrationCard>
                    </div>
                  </IntegrationsGroup>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

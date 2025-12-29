import { Card } from '~/components/ui/card'
import Link from 'next/link'
import * as React from 'react'
import { Gmail, Outlook, Facebook, Instagram, OpenPhone, ChatWidget } from '~/components/logos'

export default function ProviderIntegrationsSection() {
  return (
    <section className="relative bg-background border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
        <div className="border-x">
          <div className="bg-muted/50 py-24">
            <div className="mx-auto max-w-xl py-8 text-center">
              <h2 className="text-balance text-4xl font-semibold">Connect All Channels</h2>
              <p className="text-muted-foreground my-6 text-balance text-lg">
                Unify your customer communications across email, social media, and messaging
                platforms in one powerful dashboard.
              </p>
            </div>

            <div className="mx-auto max-w-5xl px-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ProviderIntegrationCard
                  title="Gmail"
                  description="Connect your Gmail account to automatically manage customer support emails with AI-powered responses.">
                  <Gmail />
                </ProviderIntegrationCard>

                <ProviderIntegrationCard
                  title="Outlook"
                  description="Integrate Microsoft Outlook to streamline email support across your organization.">
                  <Outlook />
                </ProviderIntegrationCard>

                <ProviderIntegrationCard
                  title="Facebook"
                  description="Manage Facebook messages and comments directly from your support dashboard.">
                  <Facebook />
                </ProviderIntegrationCard>

                <ProviderIntegrationCard
                  title="Instagram"
                  description="Respond to Instagram DMs and comments with AI assistance for faster resolution.">
                  <Instagram />
                </ProviderIntegrationCard>

                <ProviderIntegrationCard
                  title="OpenPhone"
                  description="Connect OpenPhone to handle SMS and call support requests seamlessly.">
                  <OpenPhone />
                </ProviderIntegrationCard>

                <ProviderIntegrationCard
                  title="Chat Widget"
                  description="Embed our chat widget on your website for instant customer support with AI.">
                  <ChatWidget />
                </ProviderIntegrationCard>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const ProviderIntegrationCard = ({
  title,
  description,
  children,
  link = 'https://github.com/meschacirung/cnblocks',
}: {
  title: string
  description: string
  children: React.ReactNode
  link?: string
}) => {
  return (
    <Card className="relative p-6 shadow-sm">
      <div className="*:size-8">{children}</div>

      <div className="space-y-2 pt-6">
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-muted-foreground line-clamp-2">{description}</p>
      </div>
    </Card>
  )
}

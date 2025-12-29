// apps/web/src/app/(website)/solutions/shopify-stores/_components/shopify-hero.tsx
import React from 'react'
import Link from 'next/link'
import { Button } from '~/components/ui/button'
import { ShopifyHeroIllustration } from './shopify-hero-illustration'
import { config } from '@/lib/config'

export default function HeroSection() {
  return (
    <section className="border-b">
      <div className="bg-muted py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div className="max-md:text-center">
              <span className="text-primary text-sm font-medium">Shopify Integration</span>
              <h1 className="mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl">
                AI-Powered Customer Support for Shopify Stores
              </h1>
              <p className="text-muted-foreground mb-6 mt-4 max-w-md text-balance text-lg max-md:mx-auto">
                Automate customer support with intelligent AI that understands your products,
                orders, and customers.
              </p>

              <Button asChild>
                <Link href={config.urls.signup}>Start Free Trial</Link>
              </Button>
              <Button asChild variant="outline" className="ml-3">
                <Link href={config.urls.demo}>Get a demo</Link>
              </Button>

              <div className="mt-12 grid max-w-sm grid-cols-2 max-md:mx-auto">
                <div className="space-y-2 *:block">
                  <span className="text-lg font-semibold">
                    85 <span className="text-muted-foreground text-lg">%</span>
                  </span>
                  <p className="text-muted-foreground text-balance text-sm">
                    <strong className="text-foreground font-medium">Support automation</strong> for
                    common Shopify queries.
                  </p>
                </div>

                <div className="space-y-2 *:block">
                  <span className="text-lg font-semibold">
                    3 <span className="text-muted-foreground text-lg">X</span>
                  </span>
                  <p className="text-muted-foreground text-balance text-sm">
                    <strong className="text-foreground font-medium">Faster responses</strong> with
                    instant order lookups.
                  </p>
                </div>
              </div>
            </div>

            <ShopifyHeroIllustration />
          </div>
        </div>
      </div>
    </section>
  )
}

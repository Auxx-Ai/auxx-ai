import React from 'react'
import { Mail, MessageCircleQuestion } from 'lucide-react'
import { Button } from '~/components/ui/button'
import Link from 'next/link'
import { config } from '~/lib/config'

export default function HowCanWeHelp() {
  return (
    <section className="relative border-foreground/10 border-b">
      <div className="relative z-10 mx-auto max-w-6xl border-foreground/10 border-x px-3">
        <div className="border-foreground/10 border-x">
          <div className="bg-muted py-24">
            <div className="@container mx-auto max-w-5xl px-6">
              <div className="mx-auto max-w-4xl text-center">
                <span className="text-primary bg-primary/5 border-primary/10 rounded-full border px-2 py-1 text-sm font-medium">
                  Support
                </span>
                <h1 className="mt-4 text-balance text-4xl font-semibold md:text-5xl lg:text-6xl lg:tracking-tight">
                  How can we help?
                </h1>
                <p className="text-muted-foreground mt-4 text-balance text-lg">
                  Find answers to your questions and get support for our services.
                </p>

                <div className="ring-border-illustration bg-card/25 @xl:grid-cols-2 @max-xl:divide-y @xl:divide-x relative mx-auto mt-12 grid max-w-xl overflow-hidden rounded-xl text-left shadow-md ring-1 *:p-6">
                  <div className="row-span-4 grid grid-rows-subgrid gap-4">
                    <div className="bg-card/25 ring-border-illustration flex size-8 rounded-md text-emerald-600 shadow shadow-emerald-500/25 ring-1">
                      <Mail className="m-auto size-4 *:fill-emerald-500/15" />
                    </div>
                    <h2 className="font-medium">Contact Sales</h2>
                    <p className="text-muted-foreground text-balance">
                      Get in touch with our sales team for more information.
                    </p>
                    <Button variant="outline" className="w-full" size="sm">
                      <Link href={`mailto:${config.emails.sales}`}>Talk to sales</Link>
                    </Button>
                  </div>
                  <div className="row-span-4 grid grid-rows-subgrid gap-4">
                    <div className="bg-card/25 ring-border-illustration flex size-8 rounded-md text-indigo-600 shadow shadow-indigo-500/25 ring-1">
                      <MessageCircleQuestion className="m-auto size-4 *:fill-indigo-500/15" />
                    </div>
                    <h2 className="text-lg font-medium">Help and Support</h2>
                    <p className="text-muted-foreground text-balance">
                      Find answers to your questions and get support for our services.
                    </p>

                    <Button variant="outline" size="sm" className="w-full">
                      <Link href={`mailto:${config.emails.support}`}>Contact Support</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

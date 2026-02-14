// apps/homepage/src/app/imprint/page.tsx

import type { Metadata } from 'next'
import React from 'react'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'

// metadata configures the imprint page title and description for search engines and social previews.
export const metadata: Metadata = {
  title: `Imprint | ${config.shortName}`,
  description: `${config.shortName} legal disclosure outlining company details, contact information, and statutory notices in accordance with § 5 TMG.`,
}

// ImprintPage renders the legal disclosure page with structured sections and shared layout components.
export default function ImprintPage() {
  // addressSegments preserves readability by splitting the configured address across lines.
  const addressSegments = config.address.split(',').map((segment) => segment.trim())

  return (
    <div id='root' className='relative overflow-y-auto h-screen'>
      <Header />
      <main className='mt-20'>
        <section className='relative border-foreground/10 border-y'>
          <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
            <div className='border-x'>
              <div
                aria-hidden
                className='h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-5 border-b border-foreground'
              />

              <div className='container max-w-xl px-6 py-12'>
                <h1 className='mb-8 text-4xl font-bold'>Imprint</h1>

                <div className='prose prose-gray dark:prose-invert max-w-none space-y-8'>
                  <section>
                    <p className='text-sm text-gray-500'>
                      Imprint | {config.name} Shopify Support Automation Platform
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Information according to § 5 TMG</h2>
                    <p>{config.name}</p>
                    {addressSegments.map((segment, index) => (
                      <p key={`${segment}-${index}`}>{segment}</p>
                    ))}
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Contact</h2>
                    <p>
                      E-Mail:{' '}
                      <a href={`mailto:${config.emails.support}`}>{config.emails.support}</a>
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>EU dispute resolution</h2>
                    <p>
                      The European Commission provides a platform for online dispute resolution
                      (OS):{' '}
                      <a
                        href='https://ec.europa.eu/consumers/odr'
                        target='_blank'
                        rel='noopener noreferrer'>
                        https://ec.europa.eu/consumers/odr
                      </a>
                    </p>
                    <p>You can also reach us via the contact email provided above.</p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>
                      Consumer dispute resolution/universal dispute resolution body
                    </h2>
                    <p>
                      We are not willing or obliged to participate in dispute resolution proceedings
                      before a consumer arbitration board.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Liability for contents</h2>
                    <p>
                      As a service provider, {config.name} is responsible for its own content on
                      these pages in accordance with § 7 paragraph 1 TMG under the general laws.
                      According to §§ 8 to 10 TMG, we are not obligated to monitor transmitted or
                      stored information or to investigate circumstances that indicate illegal
                      activity.
                    </p>
                    <p>
                      Obligations to remove or block the use of information under the general laws
                      remain unaffected. Liability in this regard is only possible from the point in
                      time at which a concrete infringement of the law becomes known. If we become
                      aware of any such infringements, we will remove the relevant content
                      immediately.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Liability for links</h2>
                    <p>
                      Our offer contains links to external websites of third parties, on whose
                      contents we have no influence. Therefore, we cannot assume any liability for
                      these external contents. The respective provider or operator of the sites is
                      always responsible for the content of the linked sites. The linked pages were
                      checked for possible legal violations at the time of linking. Illegal contents
                      were not recognizable at the time of linking.
                    </p>
                    <p>
                      However, a permanent control of the contents of the linked pages is not
                      reasonable without concrete evidence of a violation of the law. If we become
                      aware of any infringements, we will remove such links immediately.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>Copyright</h2>
                    <p>
                      The contents and works created by the site operators on these pages are
                      subject to applicable copyright law. Duplication, processing, distribution, or
                      any form of commercialization of such material beyond the scope of the
                      copyright law requires the prior written consent of the respective author or
                      creator. Downloads and copies of this site are permitted for private,
                      non-commercial use only.
                    </p>
                    <p>
                      Insofar as the content on this site was not created by the operator, the
                      copyrights of third parties are respected and identified as such. Should you
                      nevertheless become aware of a copyright infringement, please inform us
                      accordingly. If we become aware of any infringements, we will remove such
                      content immediately.
                    </p>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <FooterSection />
    </div>
  )
}

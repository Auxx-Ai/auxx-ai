// apps/homepage/src/app/terms-of-service/page.tsx
import React from 'react'
import type { Metadata } from 'next'
import Header from '../_components/main/header'
import FooterSection from '../_components/main/footer-section'

import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Terms of Service | ${config.shortName}`,
  description: `Review the ${config.shortName} Terms of Service covering subscriptions, AI support usage, data processing, and merchant responsibilities.`,
}

export default function TermsOfServicePage() {
  return (
    <div id="root" className="relative overflow-y-auto h-screen">
      <Header />
      <main className="mt-20">
        <section className="relative border-foreground/10 border-y">
          <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
            <div className="border-x">
              <div
                aria-hidden
                className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-15"
              />
              <div className="py-16 md:py-24 px-6">
                <h1 className="mb-8 text-4xl font-bold">Terms of Service</h1>

                <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">
                  <section>
                    <h2 className="text-2xl font-semibold">1. Acceptance of Terms</h2>
                    <p>
                      By accessing or using {config.shortName} ("the Service"), you agree to be
                      bound by these Terms of Service. If you disagree with any part of these terms,
                      you may not access the Service.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">2. Description of Service</h2>
                    <p>
                      {config.shortName} provides an AI-powered email support ticket answer service
                      for Shopify businesses. Our platform integrates email services (Gmail and
                      Outlook) with Shopify to provide automated customer support solutions.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">3. User Accounts</h2>
                    <p>
                      To use our Service, you must register for an account. You are responsible for
                      maintaining the confidentiality of your account credentials and for all
                      activities that occur under your account. You must notify us immediately of
                      any unauthorized use of your account.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">4. Subscription and Payment Terms</h2>
                    <p>
                      Some features of the Service require a subscription. Billing cycles are
                      monthly or annual, starting on the date of subscription. Payment is charged at
                      the beginning of each billing cycle. All subscriptions automatically renew
                      unless cancelled at least 24 hours before the end of the current period.
                    </p>
                    <p>
                      Refunds are provided according to our Refund Policy, available upon request.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">5. Data Processing</h2>
                    <p>
                      Our Service processes your email and Shopify data to provide automated
                      customer support. By using the Service, you grant us permission to access,
                      store, and process your data as necessary to provide the Service. We handle
                      all data in accordance with our Privacy Policy.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">6. Intellectual Property Rights</h2>
                    <p>
                      The Service and its original content, features, and functionality are owned by
                      {config.shortName} and are protected by international copyright, trademark,
                      patent, trade secret, and other intellectual property laws.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">7. User Conduct</h2>
                    <p>
                      You agree not to use the Service for any illegal purposes or to conduct any
                      unlawful activity. This includes but is not limited to: fraud, phishing,
                      violating intellectual property rights, distributing malware, or harassing
                      others.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">8. Limitation of Liability</h2>
                    <p>
                      In no event shall {config.shortName}, nor its directors, employees, partners,
                      agents, suppliers, or affiliates, be liable for any indirect, incidental,
                      special, consequential, or punitive damages, including without limitation,
                      loss of profits, data, use, goodwill, or other intangible losses, resulting
                      from your access to or use of or inability to access or use the Service.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">9. Termination</h2>
                    <p>
                      We may terminate or suspend your account and bar access to the Service
                      immediately, without prior notice or liability, under our sole discretion, for
                      any reason whatsoever, including without limitation if you breach the Terms.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">10. Changes to Terms</h2>
                    <p>
                      We reserve the right to modify or replace these Terms at any time. If a
                      revision is material, we will provide at least 30 days' notice prior to any
                      new terms taking effect. What constitutes a material change will be determined
                      at our sole discretion.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">11. Contact Us</h2>
                    <p>If you have any questions about these Terms, please contact us at:</p>
                    <p className="mt-2">
                      <strong>Email:</strong> {config.emails.support}
                    </p>
                  </section>

                  <div className="pt-6 text-sm text-gray-500">
                    <p>Last updated: May 6, 2025</p>
                  </div>
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

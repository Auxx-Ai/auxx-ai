// apps/homepage/src/app/privacy-policy/page.tsx
import React from 'react'
import type { Metadata } from 'next'
import Header from '../_components/main/header'
import FooterSection from '../_components/main/footer-section'
import { config } from '~/lib/config'

export const metadata: Metadata = {
  title: `Privacy Policy | ${config.shortName}`,
  description: `Understand how ${config.shortName} protects customer data, email content, and Shopify information with enterprise-grade security and compliance.`,
}

export default function PrivacyPolicyPage() {
  return (
    <div id="root" className="relative overflow-y-auto h-screen">
      <Header />
      <main className="mt-20">
        <section className="relative border-foreground/10 border-y">
          <div className="relative z-10 mx-auto max-w-6xl border-x px-3">
            <div className="border-x">
              <div
                aria-hidden
                className="h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-black),var(--color-black)_1px,transparent_1px,transparent_4px)] opacity-5 border-b border-foreground"
              />

              <div className="container  max-w-xl px-6 py-12">
                <h1 className="mb-8 text-4xl font-bold">Privacy Policy</h1>

                <div className="prose prose-gray dark:prose-invert max-w-none space-y-8">
                  <section>
                    <p className="text-sm text-gray-500">Last updated: May 6, 2025</p>
                    <p className="mt-4">
                      This Privacy Policy describes how {config.shortName} ("we," "us," or "our")
                      collects, uses, and shares your personal information when you use our website
                      and services. We are committed to protecting your personal information and
                      your right to privacy.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">1. Information We Collect</h2>
                    <p>
                      We collect several types of information from and about users of our Service:
                    </p>
                    <ul className="list-disc pl-6">
                      <li>
                        <strong>Account Information:</strong> When you register, we collect your
                        name, email address, and password.
                      </li>
                      <li>
                        <strong>Integration Data:</strong> We collect information from connected
                        services (Gmail, Outlook, Shopify) as necessary to provide our services,
                        including email content, customer information, and order details.
                      </li>
                      <li>
                        <strong>Usage Information:</strong> We collect information about how you
                        interact with our Service, including access times, pages viewed, and
                        features used.
                      </li>
                      <li>
                        <strong>Device Information:</strong> We collect information about your
                        device and internet connection, including IP address, browser type, and
                        operating system.
                      </li>
                      <li>
                        <strong>Cookies and Similar Technologies:</strong> We use cookies and
                        similar tracking technologies to track activity on our Service.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">2. How We Use Your Information</h2>
                    <p>We use the information we collect to:</p>
                    <ul className="list-disc pl-6">
                      <li>Provide, maintain, and improve our Service</li>
                      <li>Process and respond to customer support tickets</li>
                      <li>Generate AI-powered responses to customer inquiries</li>
                      <li>Analyze usage patterns to optimize our Service</li>
                      <li>
                        Communicate with you, including sending service updates and marketing
                        messages
                      </li>
                      <li>
                        Protect against and prevent fraud, unauthorized transactions, and security
                        issues
                      </li>
                      <li>Comply with legal obligations</li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">3. Data Storage and Processing</h2>
                    <p>
                      Your data is stored securely on cloud servers located in the United States. We
                      use industry-standard security measures to protect your information. We retain
                      your data for as long as your account is active or as needed to provide you
                      with our services, comply with legal obligations, resolve disputes, and
                      enforce our agreements.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">4. Email Content Processing</h2>
                    <p>
                      Our AI-powered system processes email content from your connected accounts to
                      provide customer support services. This includes analyzing email content,
                      generating responses, and categorizing customer inquiries. We do not use email
                      content for any purpose other than providing our service and improving our AI
                      systems.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">5. Shopify Integration</h2>
                    <p>
                      When you connect your Shopify store, we access customer, order, and product
                      data to provide our services. This information is used solely for providing
                      support to your customers and is not shared with third parties unless required
                      to provide the service or as otherwise described in this Privacy Policy.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">6. Sharing Your Information</h2>
                    <p>We may share your information in the following situations:</p>
                    <ul className="list-disc pl-6">
                      <li>
                        <strong>With Service Providers:</strong> We may share your information with
                        third-party vendors and service providers that perform services for us or on
                        our behalf.
                      </li>
                      <li>
                        <strong>With Your Consent:</strong> We may share your information when you
                        give us specific consent to do so.
                      </li>
                      <li>
                        <strong>For Legal Purposes:</strong> We may disclose your information where
                        required to comply with applicable law, governmental requests, or legal
                        process.
                      </li>
                      <li>
                        <strong>Business Transfers:</strong> If we are involved in a merger,
                        acquisition, or sale of all or a portion of our assets, your information may
                        be transferred as part of that transaction.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">7. Your Rights and Choices</h2>
                    <p>
                      Depending on your location, you may have certain rights regarding your
                      personal information:
                    </p>
                    <ul className="list-disc pl-6">
                      <li>Access your personal data</li>
                      <li>Correct inaccuracies in your personal data</li>
                      <li>Delete your personal data</li>
                      <li>Object to the processing of your personal data</li>
                      <li>Request restriction of processing your personal data</li>
                      <li>Request transfer of your personal data</li>
                      <li>Withdraw consent</li>
                    </ul>
                    <p className="mt-4">
                      To exercise these rights, please contact us using the information provided at
                      the end of this policy.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">8. Data Security</h2>
                    <p>
                      We have implemented appropriate technical and organizational security measures
                      designed to protect the security of any personal information we process.
                      However, despite our safeguards, no security system is impenetrable, and we
                      cannot guarantee the security of our systems 100%.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">9. Children's Privacy</h2>
                    <p>
                      Our Service is not directed to children under 18, and we do not knowingly
                      collect personal information from children under 18. If you are a parent or
                      guardian and you are aware that your child has provided us with personal
                      information, please contact us.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">10. Changes to This Privacy Policy</h2>
                    <p>
                      We may update our Privacy Policy from time to time. We will notify you of any
                      changes by posting the new Privacy Policy on this page and updating the "Last
                      updated" date. You are advised to review this Privacy Policy periodically for
                      any changes.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-2xl font-semibold">11. Contact Us</h2>
                    <p>
                      If you have any questions about this Privacy Policy, please contact us at:
                    </p>
                    <p className="mt-2">
                      <strong>Email:</strong> {config.emails.privacy}
                    </p>
                    <p>
                      <strong>Address:</strong> {config.address}
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

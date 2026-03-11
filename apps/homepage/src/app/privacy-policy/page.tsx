// apps/homepage/src/app/privacy-policy/page.tsx

import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'

export const metadata: Metadata = {
  title: `Privacy Policy | ${config.shortName}`,
  description: `Understand how ${config.shortName} protects customer data, email content, and Shopify information with enterprise-grade security and compliance.`,
}

export default function PrivacyPolicyPage() {
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

              <div className='container  max-w-xl px-6 py-12'>
                <h1 className='mb-8 text-4xl font-bold'>Privacy Policy</h1>

                <div className='prose prose-gray dark:prose-invert max-w-none space-y-8'>
                  <section>
                    <p className='text-sm text-gray-500'>Last updated: March 11, 2026</p>
                    <p className='mt-4'>
                      This Privacy Policy describes how {config.shortName} ("we," "us," or "our")
                      collects, uses, and shares your personal information when you use our website
                      and services. We are committed to protecting your personal information and
                      your right to privacy.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>1. Information We Collect</h2>
                    <p>
                      We collect several types of information from and about users of our Service:
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Account Information:</strong> When you register, we collect your
                        name, email address, and password.
                      </li>
                      <li>
                        <strong>Integration Data:</strong> We collect information from connected
                        services (Gmail, Outlook, Shopify) as necessary to provide our services,
                        including email content, headers, labels, customer information, and order
                        details. For Gmail-specific data, see Section 5 below.
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
                    <h2 className='text-2xl font-semibold'>2. How We Use Your Information</h2>
                    <p>We use the information we collect to:</p>
                    <ul className='list-disc pl-6'>
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
                    <h2 className='text-2xl font-semibold'>3. Data Storage and Processing</h2>
                    <p>
                      Your data is stored securely on cloud servers located in the United States. We
                      use industry-standard security measures to protect your information. We retain
                      your data for as long as your account is active or as needed to provide you
                      with our services, comply with legal obligations, resolve disputes, and
                      enforce our agreements.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>4. Email Content Processing</h2>
                    <p>
                      Our AI-powered system processes email content from your connected accounts to
                      provide customer support services. This includes analyzing email content,
                      generating responses, and categorizing customer inquiries. We do not use email
                      content for any purpose other than providing our service. For Gmail-specific
                      data handling, see Section 5 below.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>
                      5. Google API Services &amp; Gmail Integration
                    </h2>
                    <p>
                      When you connect your Gmail account to {config.shortName}, we access your
                      Google user data through the Gmail API. This section describes how we handle
                      data obtained from Google APIs.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Data We Access</h3>
                    <p>We request the following OAuth scopes from Google:</p>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Gmail Read Access</strong> (gmail.readonly) — to read incoming email
                        messages and threads for customer support ticket processing.
                      </li>
                      <li>
                        <strong>Gmail Send Access</strong> (gmail.send) — to send replies to
                        customer support inquiries on your behalf.
                      </li>
                      <li>
                        <strong>Gmail Labels</strong> (gmail.labels) — to create and manage labels
                        for organizing and categorizing support tickets.
                      </li>
                      <li>
                        <strong>Gmail Modify</strong> (gmail.modify) — to modify message status
                        (e.g., mark as read, archive, or move messages).
                      </li>
                      <li>
                        <strong>Push Notifications</strong> (pubsub) — to receive real-time
                        notifications when new emails arrive, enabling immediate ticket processing.
                      </li>
                      <li>
                        <strong>User Email Address</strong> (userinfo.email) — to identify the
                        connected Gmail account.
                      </li>
                    </ul>

                    <h3 className='text-xl font-semibold mt-4'>How We Use Google User Data</h3>
                    <p>
                      Google user data is used solely to provide {config.shortName}'s customer
                      support automation service. Specifically, we use it to:
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>Read and process incoming customer emails as support tickets</li>
                      <li>Generate AI-powered responses to customer inquiries</li>
                      <li>Send replies through your connected Gmail account</li>
                      <li>Organize emails with labels for ticket categorization</li>
                      <li>Provide real-time notifications of new customer messages</li>
                    </ul>
                    <p className='mt-2'>
                      We do <strong>not</strong> use Google user data for advertising, market
                      research, or any purpose unrelated to providing our service.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Data Storage &amp; Retention</h3>
                    <p>
                      Email content and metadata retrieved from Gmail are stored on encrypted,
                      US-based cloud servers. We retain this data for as long as your account is
                      active and your Gmail integration is connected. When you disconnect your Gmail
                      account or delete your {config.shortName} account, we delete cached email data
                      from our systems.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Data Sharing</h3>
                    <p>
                      Google user data is not sold to third parties. We share the minimum data
                      necessary with AI service providers (such as OpenAI and Anthropic) solely for
                      the purpose of generating customer support responses. No other third parties
                      receive your Google user data unless required by law.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      Google API Services User Data Policy Compliance
                    </h3>
                    <p>
                      {config.shortName}'s use and transfer of information received from Google APIs
                      adheres to the{' '}
                      <a
                        href='https://developers.google.com/terms/api-services-user-data-policy'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        Google API Services User Data Policy
                      </a>
                      , including the Limited Use requirements. We only use Google user data to
                      provide and improve the user-facing features that are visible and prominent in
                      our application's user interface.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Revoking Access</h3>
                    <p>
                      You can disconnect your Gmail account from {config.shortName} at any time
                      through your account settings. You can also revoke access directly from your{' '}
                      <a
                        href='https://myaccount.google.com/permissions'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        Google Account permissions page
                      </a>
                      . Upon disconnection, we will stop accessing your Gmail data and delete cached
                      email content from our systems.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>6. Shopify Integration</h2>
                    <p>
                      When you connect your Shopify store, we access customer, order, and product
                      data to provide our services. This information is used solely for providing
                      support to your customers and is not shared with third parties unless required
                      to provide the service or as otherwise described in this Privacy Policy.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>7. Sharing Your Information</h2>
                    <p>We may share your information in the following situations:</p>
                    <ul className='list-disc pl-6'>
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
                    <h2 className='text-2xl font-semibold'>8. Your Rights and Choices</h2>
                    <p>
                      Depending on your location, you may have certain rights regarding your
                      personal information:
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>Access your personal data</li>
                      <li>Correct inaccuracies in your personal data</li>
                      <li>Delete your personal data</li>
                      <li>Object to the processing of your personal data</li>
                      <li>Request restriction of processing your personal data</li>
                      <li>Request transfer of your personal data</li>
                      <li>Withdraw consent</li>
                    </ul>
                    <p className='mt-4'>
                      To exercise these rights, please contact us using the information provided at
                      the end of this policy.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>9. Data Security</h2>
                    <p>
                      We have implemented appropriate technical and organizational security measures
                      designed to protect the security of any personal information we process.
                      However, despite our safeguards, no security system is impenetrable, and we
                      cannot guarantee the security of our systems 100%.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>10. Children&apos;s Privacy</h2>
                    <p>
                      Our Service is not directed to children under 18, and we do not knowingly
                      collect personal information from children under 18. If you are a parent or
                      guardian and you are aware that your child has provided us with personal
                      information, please contact us.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>11. Changes to This Privacy Policy</h2>
                    <p>
                      We may update our Privacy Policy from time to time. We will notify you of any
                      changes by posting the new Privacy Policy on this page and updating the "Last
                      updated" date. You are advised to review this Privacy Policy periodically for
                      any changes.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>12. Contact Us</h2>
                    <p>
                      If you have any questions about this Privacy Policy, please contact us at:
                    </p>
                    <p className='mt-2'>
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

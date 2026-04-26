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
                    <p className='text-sm text-gray-500'>Last updated: April 26, 2026</p>
                    <p className='mt-4'>
                      This Privacy Policy describes how {config.shortName} ("we," "us," or "our")
                      collects, uses, and shares your personal information when you use our website,
                      browser extension, and services (collectively, the "Service"). We are
                      committed to protecting your personal information and your right to privacy.
                    </p>
                    <h3 className='text-xl font-semibold mt-6'>Geographic Scope</h3>
                    <p>
                      The Service is intended for users in the <strong>United States</strong>. We do
                      not target or actively offer the Service to individuals located in the
                      European Economic Area (EEA), the United Kingdom, or Switzerland, and we ask
                      that residents of those regions not use the Service. If you access the Service
                      from outside the United States, you do so on your own initiative and are
                      responsible for compliance with your local laws. We may decline accounts or
                      billing addresses associated with regions where we do not currently operate.
                    </p>
                    <h3 className='text-xl font-semibold mt-6'>Who We Are</h3>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Legal entity:</strong> {config.shortName}{' '}
                        <em className='text-gray-500'>(legal name to be confirmed)</em>
                      </li>
                      <li>
                        <strong>Registered address:</strong> {config.address}
                      </li>
                      <li>
                        <strong>Privacy contact:</strong>{' '}
                        <a
                          href={`mailto:${config.emails.privacy}`}
                          className='text-blue-600 hover:underline dark:text-blue-400'>
                          {config.emails.privacy}
                        </a>
                      </li>
                    </ul>
                    <p className='mt-2'>
                      When you use the {config.shortName} browser extension to capture contact or
                      company information about other people (for example, from a LinkedIn profile),{' '}
                      <strong>you are responsible for that captured data</strong> — including
                      ensuring you have a lawful basis under applicable U.S. law and the terms of
                      service of the source site. {config.shortName} stores and processes that data
                      on your behalf as part of providing the Service.
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
                        similar tracking technologies to track activity on our Service. Strictly
                        necessary cookies (authentication, session, security) are set without
                        consent. Non-essential cookies (analytics, preferences) are set only after
                        you give consent through our cookie banner. You can change your cookie
                        preferences at any time via the "Cookie settings" link in our footer.
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

                    <h3 className='text-xl font-semibold mt-4'>Marketing Communications</h3>
                    <p>
                      You can opt out of marketing emails at any time by clicking the "Unsubscribe"
                      link in any marketing message we send, or by emailing{' '}
                      <a
                        href={`mailto:${config.emails.privacy}`}
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        {config.emails.privacy}
                      </a>
                      . Opting out of marketing does not affect transactional emails (security
                      alerts, billing notices, account changes), which we are required to send.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>3. Data Storage and Retention</h2>
                    <p>
                      Your data is stored on cloud servers located in the United States, encrypted
                      at rest and in transit. We use industry-standard security measures to protect
                      your information.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Retention</h3>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Account data</strong> (name, email, organization): for as long as
                        your account is active. Deleted within 30 days of account closure, except
                        where we are required by law to retain it (e.g. tax / billing records for up
                        to 7 years).
                      </li>
                      <li>
                        <strong>Email content + ticket data</strong> from connected mailboxes: for
                        as long as your integration is connected, plus a 30-day grace period after
                        disconnection or account closure. Permanently deleted thereafter.
                      </li>
                      <li>
                        <strong>Captured contacts and companies</strong> (including those captured
                        via the browser extension): for as long as you keep them in your workspace.
                        Deleted on user request, or within 30 days of account closure.
                      </li>
                      <li>
                        <strong>Logs and analytics</strong>: aggregated for up to 13 months;
                        identifiable usage logs for up to 90 days.
                      </li>
                      <li>
                        <strong>Backups</strong>: routine encrypted backups are retained up to 35
                        days, after which deletions propagate fully.
                      </li>
                    </ul>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>
                      4. Email Content Processing and Automated Decision-Making
                    </h2>
                    <p>
                      Our AI-powered system processes email content from your connected accounts to
                      provide customer support services. This includes analyzing email content,
                      generating responses, and categorizing customer inquiries. We do not use email
                      content for any purpose other than providing our service, including not using
                      it to train general-purpose AI models. For Gmail-specific data handling, see
                      Section 5 below.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Use of AI in the Service</h3>
                    <p>
                      The Service uses large language models (currently provided by OpenAI and
                      Anthropic) to draft replies, classify tickets, and surface suggested actions
                      to your support agents. By default, AI-drafted replies appear as drafts that a
                      human reviews and sends from the {config.shortName} inbox.
                    </p>
                    <p className='mt-2'>
                      The Service also offers a <strong>workflow builder</strong> that lets the
                      workspace operator chain an AI generation step directly to a "send reply"
                      step. When an operator configures and enables such a workflow, replies can be
                      generated and sent to customers without a human reviewing each individual
                      message. The workspace operator chooses whether to put a human in the loop,
                      what triggers the workflow, and what the AI is allowed to send.{' '}
                      {config.shortName} executes the workflow as configured. If you operate a
                      workflow whose AI-generated outputs could meaningfully affect a recipient (for
                      example, denying a refund or closing an account), you are responsible for
                      ensuring appropriate human review and for making any required disclosures to
                      the people you communicate with.
                    </p>
                    <p className='mt-2'>
                      If you receive a message from a {config.shortName} workspace and have
                      questions about how AI was used, contact that workspace directly. You can also
                      reach us at{' '}
                      <a
                        href={`mailto:${config.emails.privacy}`}
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        {config.emails.privacy}
                      </a>{' '}
                      and we will route the request to the responsible workspace.
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
                    <h2 className='text-2xl font-semibold'>7. Browser Extension</h2>
                    <p>
                      The {config.shortName} browser extension lets you save contacts and companies
                      into your {config.shortName} workspace from sites you visit. The extension is
                      optional and runs only when you install it from the Chrome Web Store and
                      activate it.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      Sites Where the Extension Reads Page Content
                    </h3>
                    <p>
                      The extension reads page content (DOM) only on the following sites, and only
                      when you click the {config.shortName} button or open the extension panel:
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>LinkedIn (linkedin.com), including Sales Navigator</li>
                      <li>Gmail (mail.google.com)</li>
                      <li>X / Twitter (x.com, twitter.com)</li>
                      <li>Facebook (facebook.com)</li>
                      <li>Instagram (instagram.com)</li>
                      <li>Any company website you choose to capture as a company record</li>
                    </ul>
                    <p className='mt-2'>
                      On every other site, the extension does nothing more than render its own panel
                      chrome. It does not record clicks, keystrokes, mouse movements, or browsing
                      history outside of the supported sites listed above.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>What the Extension Sends</h3>
                    <p>
                      When you save a contact or company through the extension, the parsed fields
                      (name, email, phone, profile URL, company name, domain, avatar URL) are sent
                      to your {config.shortName} workspace via our API. We do not send page content
                      to any other destination or use it for any purpose other than creating or
                      updating the record you save.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      What the Extension Stores Locally
                    </h3>
                    <p>
                      The extension stores the following in your browser's local extension storage (
                      <code>chrome.storage.local</code>):
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>Your color-theme preference (light or dark)</li>
                      <li>The identifier of your active {config.shortName} workspace</li>
                    </ul>
                    <p className='mt-2'>
                      The extension does not store passwords, contacts, page content, or any other
                      personal data on your device. Authentication uses a short-lived bearer token
                      minted from your existing {config.shortName} session when you open the
                      record-detail panel; the token is held in iframe memory and is not persisted.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Revoking Access</h3>
                    <p>
                      You can remove the extension at any time from <code>chrome://extensions</code>
                      . Uninstalling the extension deletes its locally stored preferences and the
                      active-workspace identifier. Records you have already saved remain in your{' '}
                      {config.shortName} workspace and are managed there.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      Capturing Information About Other People
                    </h3>
                    <p>
                      When you use the extension to save a profile or page as a contact or company,
                      you are capturing personal information about another individual.{' '}
                      <strong>You are responsible for that captured data</strong> — including
                      ensuring you have a lawful basis to capture and store it under applicable U.S.
                      law and the terms of service of the source site (LinkedIn, Gmail, X, Facebook,
                      Instagram, etc.). If a captured individual asks us to remove their
                      information, we will work with you to honor that request.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>8. Sharing Your Information</h2>
                    <p>We may share your information in the following situations:</p>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>With Subprocessors:</strong> We share the minimum data necessary
                        with vetted third-party vendors who perform services on our behalf. Each
                        subprocessor is bound by a written agreement that requires them to use the
                        data only to provide the contracted service and to maintain confidentiality
                        and security at least equivalent to ours.
                      </li>
                      <li>
                        <strong>With Your Consent:</strong> We may share your information when you
                        give us specific consent to do so (for example, when you connect a
                        third-party integration).
                      </li>
                      <li>
                        <strong>For Legal Purposes:</strong> We may disclose your information where
                        required to comply with applicable law, governmental requests, or legal
                        process.
                      </li>
                      <li>
                        <strong>Business Transfers:</strong> If we are involved in a merger,
                        acquisition, or sale of all or a portion of our assets, your information may
                        be transferred as part of that transaction. The acquirer will assume all
                        obligations under this Privacy Policy, and we will notify you in advance of
                        any such transfer.
                      </li>
                    </ul>

                    <h3 className='text-xl font-semibold mt-4'>Categories of Subprocessors</h3>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Cloud infrastructure:</strong> Amazon Web Services (US) — hosting,
                        databases, file storage.
                      </li>
                      <li>
                        <strong>AI providers:</strong> OpenAI (US), Anthropic (US) — generating
                        AI-drafted ticket replies.
                      </li>
                      <li>
                        <strong>Email delivery:</strong> Mailgun / Amazon SES (US) — transactional
                        and marketing email.
                      </li>
                      <li>
                        <strong>Payments:</strong> Stripe (US) — billing and subscription
                        management.
                      </li>
                      <li>
                        <strong>Error monitoring &amp; analytics:</strong> Sentry, PostHog (US) —
                        crash reports and usage analytics (anonymized where possible).
                      </li>
                    </ul>
                    <p className='mt-2'>
                      A current list of all subprocessors is maintained at{' '}
                      <a
                        href='https://auxx.ai/subprocessors'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        auxx.ai/subprocessors
                      </a>
                      . We will notify you at least 30 days before adding a new subprocessor that
                      processes personal information on your behalf, giving you a reasonable
                      opportunity to object.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>9. Your Rights and Choices</h2>
                    <p>Subject to applicable U.S. law, you may request to:</p>
                    <ul className='list-disc pl-6'>
                      <li>Access the personal information we hold about you</li>
                      <li>Correct inaccurate personal information</li>
                      <li>Delete your personal information (subject to legal exceptions)</li>
                      <li>
                        Withdraw consent at any time, where we rely on consent (this does not affect
                        the lawfulness of processing carried out before withdrawal)
                      </li>
                      <li>Opt out of marketing communications</li>
                    </ul>
                    <p className='mt-4'>
                      California residents have additional rights — see Section 10. To exercise any
                      of the rights above, email us at{' '}
                      <a
                        href={`mailto:${config.emails.privacy}`}
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        {config.emails.privacy}
                      </a>
                      . We will respond within 30 days. We may need to verify your identity before
                      acting on a request.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>
                      10. California Residents (CCPA / CPRA)
                    </h2>
                    <p>
                      This section applies to California residents and supplements the rest of this
                      Privacy Policy. It is provided under the California Consumer Privacy Act, as
                      amended by the California Privacy Rights Act ("CCPA").
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      Categories of Personal Information We Collect
                    </h3>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>Identifiers</strong> (name, email, IP address, account ID):
                        collected.
                      </li>
                      <li>
                        <strong>Customer records</strong> (billing information, payment details
                        processed via Stripe): collected.
                      </li>
                      <li>
                        <strong>Commercial information</strong> (subscription tier, usage history):
                        collected.
                      </li>
                      <li>
                        <strong>Internet/network activity</strong> (cookie data, log data, device
                        info): collected.
                      </li>
                      <li>
                        <strong>Geolocation data</strong>: only coarse, IP-derived (not GPS).
                      </li>
                      <li>
                        <strong>Inferences</strong> (drawn from usage to improve the Service):
                        limited — we do not build profiles for advertising.
                      </li>
                      <li>
                        <strong>Sensitive personal information</strong> (account credentials):
                        passwords are stored hashed; bearer tokens are short-lived.
                      </li>
                      <li>
                        Categories <strong>not</strong> collected: protected classifications,
                        biometric information, health information, precise geolocation, education
                        records.
                      </li>
                    </ul>

                    <h3 className='text-xl font-semibold mt-4'>
                      Sources, Purposes, and Disclosures
                    </h3>
                    <p>
                      We collect personal information directly from you, from your use of the
                      Service, and from the integrations you connect (Gmail, Outlook, Shopify). We
                      use it for the business purposes described in Section 2 above. We disclose
                      personal information only to the categories of subprocessors listed in Section
                      8, and only as needed to provide the Service.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>
                      "Sale" or "Sharing" of Personal Information
                    </h3>
                    <p>
                      <strong>
                        We do not sell or share personal information for cross-context behavioral
                        advertising under the CCPA.
                      </strong>{' '}
                      We have not done so in the preceding 12 months and do not intend to. Because
                      we do not sell or share personal information, we do not provide a "Do Not Sell
                      or Share My Personal Information" link — but if our practices ever change, we
                      will update this Policy, post a clear opt-out, and obtain any legally required
                      consent.
                    </p>

                    <h3 className='text-xl font-semibold mt-4'>Your CCPA Rights</h3>
                    <p>California residents have the right to:</p>
                    <ul className='list-disc pl-6'>
                      <li>Know what personal information we collect and how we use it</li>
                      <li>Access a copy of your personal information</li>
                      <li>Correct inaccurate personal information</li>
                      <li>Delete your personal information (subject to legal exceptions)</li>
                      <li>
                        Opt out of the sale or sharing of personal information (we do not sell or
                        share — see above)
                      </li>
                      <li>
                        Limit the use and disclosure of sensitive personal information (we already
                        limit it to providing the Service)
                      </li>
                      <li>Non-discrimination for exercising any of these rights</li>
                    </ul>
                    <p className='mt-2'>
                      To exercise these rights, email{' '}
                      <a
                        href={`mailto:${config.emails.privacy}`}
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        {config.emails.privacy}
                      </a>
                      . We will verify your request before acting on it. You may also designate an
                      authorized agent to make a request on your behalf, subject to verification.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>11. Data Security</h2>
                    <p>
                      We have implemented appropriate technical and organizational security measures
                      designed to protect the security of any personal information we process.
                      However, despite our safeguards, no security system is impenetrable, and we
                      cannot guarantee the security of our systems 100%.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>12. Children&apos;s Privacy</h2>
                    <p>
                      Our Service is intended for use by businesses and is not directed to children.
                      We do not knowingly collect personal information from children under 13 (under
                      the U.S. Children's Online Privacy Protection Act, "COPPA"). If you are a
                      parent or guardian and you believe your child has provided us with personal
                      information, please contact us at{' '}
                      <a
                        href={`mailto:${config.emails.privacy}`}
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        {config.emails.privacy}
                      </a>{' '}
                      and we will delete it.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>13. Changes to This Privacy Policy</h2>
                    <p>
                      We may update our Privacy Policy from time to time. We will notify you of any
                      changes by posting the new Privacy Policy on this page and updating the "Last
                      updated" date. For material changes (changes that meaningfully affect how we
                      collect, use, or share your personal information), we will give you at least
                      30 days' advance notice by email to the address associated with your account,
                      and where required by law we will obtain your consent before the changes take
                      effect.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-2xl font-semibold'>14. Contact Us</h2>
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

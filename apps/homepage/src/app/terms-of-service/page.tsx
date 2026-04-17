// apps/homepage/src/app/terms-of-service/page.tsx

import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'

export const metadata: Metadata = {
  title: `Terms of Service | ${config.shortName}`,
  description: `Review the ${config.shortName} Terms of Service covering subscriptions, AI-generated output, acceptable use, liability, and dispute resolution.`,
}

const SECTIONS: { id: string; title: string }[] = [
  { id: 'acceptance', title: '1. Introduction & Acceptance' },
  { id: 'definitions', title: '2. Definitions' },
  { id: 'service', title: '3. The Service' },
  { id: 'accounts', title: '4. Accounts & Authorized Users' },
  { id: 'subscription', title: '5. Subscription, Orders & Fees' },
  { id: 'payment', title: '6. Payment & Late Payment' },
  { id: 'cancellation', title: '7. Cancellation & Term' },
  { id: 'customer-data', title: '8. Customer Data & Ownership' },
  { id: 'ai-output', title: '9. AI Output' },
  { id: 'acceptable-use', title: '10. Acceptable Use Policy' },
  { id: 'third-party', title: '11. Third-Party Services & Integrations' },
  { id: 'privacy', title: '12. Privacy & Data Protection' },
  { id: 'security', title: '13. Security' },
  { id: 'ip', title: '14. Intellectual Property' },
  { id: 'confidentiality', title: '15. Confidentiality' },
  { id: 'warranties', title: '16. Warranties & Disclaimer' },
  { id: 'indemnification', title: '17. Indemnification' },
  { id: 'liability', title: '18. Limitation of Liability' },
  { id: 'term', title: '19. Term & Termination' },
  { id: 'beta', title: '20. Beta Features' },
  { id: 'modifications', title: '21. Service Modifications' },
  { id: 'notices', title: '22. Notices' },
  { id: 'dmca', title: '23. DMCA & Copyright' },
  { id: 'governing-law', title: '24. Governing Law & Dispute Resolution' },
  { id: 'export', title: '25. Export Controls & Sanctions' },
  { id: 'misc', title: '26. Miscellaneous' },
  { id: 'contact', title: '27. Contact Us' },
]

export default function TermsOfServicePage() {
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

              <div className='container max-w-2xl px-6 py-12'>
                <h1 className='mb-4 text-4xl font-bold'>Terms of Service</h1>
                <p className='text-sm text-gray-500'>Last updated: April 16, 2026</p>

                <div className='prose prose-gray dark:prose-invert max-w-none space-y-8 mt-8'>
                  <section>
                    <p>
                      These Terms of Service ("<strong>Terms</strong>") are a binding agreement
                      between Auxx AI, LLC, a Delaware limited liability company with its principal
                      place of business at {config.address} ("<strong>Auxx</strong>," "
                      <strong>we</strong>," "<strong>us</strong>," or "<strong>our</strong>"), and
                      the person or entity that accesses or uses the Service ("
                      <strong>Customer</strong>" or "<strong>you</strong>"). By clicking to accept,
                      signing an Order Form that references these Terms, or accessing or using the
                      Service, you agree to be bound by these Terms. If you do not agree, you may
                      not access or use the Service.
                    </p>
                  </section>

                  <section>
                    <h2 className='text-xl font-semibold'>Contents</h2>
                    <ol className='list-decimal pl-6 text-sm space-y-1'>
                      {SECTIONS.map((s) => (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            className='text-blue-600 hover:underline dark:text-blue-400'>
                            {s.title.replace(/^\d+\.\s/, '')}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section id='acceptance'>
                    <h2 className='text-2xl font-semibold'>1. Introduction & Acceptance</h2>
                    <p>
                      These Terms, together with any Order Form, the Privacy Policy, the Data
                      Processing Addendum (where applicable), and any documentation we make
                      available (collectively, the "<strong>Agreement</strong>"), govern your use of
                      the Service. You represent that you are at least 18 years old and, if you
                      enter into this Agreement on behalf of a company or other legal entity, that
                      you have the authority to bind that entity. The Service is intended for
                      business use and is not offered for personal, family, or household purposes.
                    </p>
                  </section>

                  <section id='definitions'>
                    <h2 className='text-2xl font-semibold'>2. Definitions</h2>
                    <ul className='list-disc pl-6'>
                      <li>
                        <strong>"Service"</strong> means the {config.shortName}{' '}
                        software-as-a-service platform, including the web application, APIs,
                        integrations, documentation, and related services we provide.
                      </li>
                      <li>
                        <strong>"Customer Data"</strong> means any data, content, or other materials
                        submitted to, uploaded to, or processed through the Service by or on behalf
                        of Customer, including emails, tickets, customer records, and integration
                        data.
                      </li>
                      <li>
                        <strong>"Authorized User"</strong> means an employee, contractor, or agent
                        of Customer who is authorized by Customer to access and use the Service
                        under Customer's account.
                      </li>
                      <li>
                        <strong>"Order Form"</strong> means any online subscription selection or
                        signed ordering document that references these Terms and specifies the
                        Service plan, fees, and term.
                      </li>
                      <li>
                        <strong>"AI Output"</strong> means any text, classification, summary, draft
                        response, or other output generated by the Service's artificial intelligence
                        and large language model features.
                      </li>
                      <li>
                        <strong>"Integration"</strong> means any third-party product or service
                        (e.g., Gmail, Microsoft Outlook, Shopify, OpenAI, Anthropic) that Customer
                        connects to the Service.
                      </li>
                      <li>
                        <strong>"Documentation"</strong> means the user guides and technical
                        documentation we make generally available for the Service.
                      </li>
                      <li>
                        <strong>"Confidential Information"</strong> means non-public information
                        disclosed by one party to the other that is identified as confidential or
                        that a reasonable person would understand to be confidential given its
                        nature and the circumstances of disclosure.
                      </li>
                    </ul>
                  </section>

                  <section id='service'>
                    <h2 className='text-2xl font-semibold'>3. The Service</h2>
                    <p>
                      The Service is an AI-assisted customer support platform that helps businesses
                      triage, draft, and respond to customer messages. The Service supports
                      Integrations with email providers (including Gmail and Microsoft Outlook),
                      commerce platforms (including Shopify), and other third-party systems. We may
                      update, modify, or add features to the Service from time to time as described
                      in Section 21.
                    </p>
                  </section>

                  <section id='accounts'>
                    <h2 className='text-2xl font-semibold'>4. Accounts & Authorized Users</h2>
                    <p>
                      To use the Service, you must create an account and provide accurate, current,
                      and complete information. You are responsible for (a) maintaining the
                      confidentiality of your account credentials, (b) all activities that occur
                      under your account or the accounts of your Authorized Users, and (c) ensuring
                      that each Authorized User complies with this Agreement. You must notify us
                      promptly of any suspected unauthorized access or use. We may require multi-
                      factor authentication or other security controls.
                    </p>
                  </section>

                  <section id='subscription'>
                    <h2 className='text-2xl font-semibold'>5. Subscription, Orders & Fees</h2>
                    <p>
                      The Service is provided on a subscription basis pursuant to an Order. Unless
                      the Order specifies otherwise, subscriptions begin on the start date
                      identified in the Order and automatically renew for successive terms equal to
                      the initial term. Fees are specified in the Order and are exclusive of taxes,
                      which are your responsibility (other than taxes on our net income).
                    </p>
                    <p>
                      We may change fees effective on renewal by giving you at least thirty (30)
                      days' written notice before the end of the then-current term. Except as
                      expressly stated in this Agreement or required by applicable law, all fees are
                      non-refundable.
                    </p>
                  </section>

                  <section id='payment'>
                    <h2 className='text-2xl font-semibold'>6. Payment & Late Payment</h2>
                    <p>
                      You authorize us and our payment processor to charge the payment method on
                      file for all fees due. If a payment is not received when due, we may (a)
                      charge interest on the overdue amount at the lesser of 1.5% per month or the
                      maximum rate permitted by law, and (b) after reasonable notice, suspend the
                      Service until payment is received. Continued non-payment is a material breach
                      and grounds for termination under Section 19.
                    </p>
                  </section>

                  <section id='cancellation'>
                    <h2 className='text-2xl font-semibold'>7. Cancellation & Term</h2>
                    <p>
                      You may cancel a monthly subscription at any time through the account
                      settings; cancellation takes effect at the end of the then-current billing
                      period, and you will retain access through that date. Annual subscriptions may
                      be non-cancellable mid-term as specified in the Order. No refunds will be
                      provided for partial billing periods except where required by applicable law.
                    </p>
                  </section>

                  <section id='customer-data'>
                    <h2 className='text-2xl font-semibold'>8. Customer Data & Ownership</h2>
                    <p>
                      As between the parties, you own all right, title, and interest in and to
                      Customer Data. You grant us a worldwide, non-exclusive, royalty-free license
                      to host, store, process, transmit, display, and otherwise use Customer Data
                      solely as necessary to provide, maintain, and improve the Service, to prevent
                      or address technical or security issues, and as permitted by the Privacy
                      Policy. You represent and warrant that you have all rights, consents, and
                      authorizations necessary to provide Customer Data to us and to authorize its
                      use in connection with the Service.
                    </p>
                    <p>
                      We may generate aggregated or de-identified data derived from Customer Data ("
                      <strong>Aggregated Data</strong>") and use Aggregated Data for any lawful
                      business purpose, including to improve the Service, provided that Aggregated
                      Data does not identify you, any Authorized User, or any individual.
                    </p>
                  </section>

                  <section id='ai-output'>
                    <h2 className='text-2xl font-semibold'>9. AI Output</h2>
                    <p>
                      The Service uses artificial intelligence and large language models to generate
                      draft responses, summaries, classifications, and other output ("
                      <strong>AI Output</strong>"). AI Output is probabilistic and may contain
                      errors, inaccuracies, or content that is incomplete, offensive, or unsuitable
                      for a given context. You acknowledge and agree that:
                    </p>
                    <ul className='list-disc pl-6'>
                      <li>
                        AI Output is provided as a starting point for your review, not as a final or
                        verified response;
                      </li>
                      <li>
                        You are solely responsible for reviewing, editing, and approving AI Output
                        before it is sent to any third party, including your end customers;
                      </li>
                      <li>
                        AI Output does not constitute legal, medical, financial, tax, or other
                        professional advice;
                      </li>
                      <li>
                        You are solely responsible for ensuring that any message you send, including
                        AI Output you approve, complies with all applicable laws, including
                        CAN-SPAM, TCPA, GDPR, consumer protection laws, and industry regulations;
                      </li>
                      <li>
                        We do not warrant the accuracy, completeness, fitness for purpose, or
                        non-infringement of any AI Output; and
                      </li>
                      <li>
                        Certain AI features rely on third-party model providers (such as OpenAI,
                        Anthropic, or Google). Your AI Output may be processed by those providers
                        subject to their terms and our Data Processing Addendum.
                      </li>
                    </ul>
                    <p>
                      You may configure the Service to send AI Output automatically (for example,
                      through auto-reply rules). If you do, you remain fully responsible for the
                      content of those messages, and the disclaimers in this Section continue to
                      apply.
                    </p>
                  </section>

                  <section id='acceptable-use'>
                    <h2 className='text-2xl font-semibold'>10. Acceptable Use Policy</h2>
                    <p>You will not, and will not permit any Authorized User or third party to:</p>
                    <ul className='list-disc pl-6'>
                      <li>
                        use the Service to send unsolicited commercial messages, spam, phishing
                        attempts, or messages that violate CAN-SPAM, TCPA, or similar laws;
                      </li>
                      <li>
                        use the Service to transmit content that is unlawful, defamatory, harassing,
                        threatening, obscene, or that infringes or misappropriates the intellectual
                        property, privacy, or other rights of any person;
                      </li>
                      <li>
                        upload or transmit any material that contains viruses, malware, or other
                        harmful code;
                      </li>
                      <li>
                        reverse engineer, decompile, disassemble, or attempt to derive the source
                        code or underlying models of the Service, except to the extent this
                        restriction is prohibited by applicable law;
                      </li>
                      <li>
                        circumvent or attempt to circumvent any rate limits, access controls, or
                        usage quotas;
                      </li>
                      <li>
                        use the Service to build or train a competing product or AI model, or to
                        benchmark the Service for competitive purposes;
                      </li>
                      <li>
                        resell, sublicense, or provide the Service on a service-bureau basis to any
                        third party unless expressly permitted in an Order;
                      </li>
                      <li>
                        use the Service in violation of any applicable law, regulation, or
                        third-party terms (including the terms of any Integration); or
                      </li>
                      <li>
                        use the Service to process special categories of personal data (such as
                        health information, government identifiers, or payment card data) except
                        through features explicitly designed and authorized by us for that purpose.
                      </li>
                    </ul>
                    <p>
                      We may investigate suspected violations and, without limiting our other
                      rights, suspend or terminate access for any violation under Section 19.
                    </p>
                  </section>

                  <section id='third-party'>
                    <h2 className='text-2xl font-semibold'>
                      11. Third-Party Services & Integrations
                    </h2>
                    <p>
                      The Service enables you to connect Integrations. Your use of an Integration is
                      governed by the terms and privacy policies of the applicable third party (for
                      example, Google's Terms of Service for Gmail, Microsoft's terms for Outlook,
                      Shopify's Partner and Merchant terms, and the terms of any AI model provider).
                      You are responsible for complying with those terms and for maintaining your
                      own agreements with those providers. We are not responsible for (a) the
                      availability, accuracy, or content of any third-party service, (b) changes,
                      suspensions, or discontinuations of any third-party API, or (c) any loss or
                      damage caused by a third-party service. If a third party discontinues or
                      restricts an Integration, we may modify or remove the corresponding feature of
                      the Service without liability.
                    </p>
                  </section>

                  <section id='privacy'>
                    <h2 className='text-2xl font-semibold'>12. Privacy & Data Protection</h2>
                    <p>
                      Our collection and use of personal information in connection with the Service
                      is described in our{' '}
                      <a
                        href='/privacy-policy'
                        className='text-blue-600 hover:underline dark:text-blue-400'>
                        Privacy Policy
                      </a>
                      , which is incorporated into this Agreement by reference. To the extent we
                      process personal data subject to the GDPR, UK GDPR, or CCPA/CPRA on your
                      behalf, we will do so as a processor (or service provider) under our Data
                      Processing Addendum ("<strong>DPA</strong>"), which is available upon request
                      at {config.emails.privacy} and is incorporated into this Agreement when
                      executed or when required by applicable law. You are the controller (or
                      business) of Customer Data and are responsible for the lawful basis for its
                      processing.
                    </p>
                  </section>

                  <section id='security'>
                    <h2 className='text-2xl font-semibold'>13. Security</h2>
                    <p>
                      We maintain administrative, technical, and physical safeguards designed to
                      protect the Service and Customer Data against unauthorized access, use,
                      disclosure, alteration, or destruction. These safeguards include encryption of
                      data in transit and at rest, access controls, logging and monitoring, and
                      vendor risk reviews. No system is fully secure, and we do not warrant that the
                      Service will be free from unauthorized access. If we become aware of a
                      security incident affecting Customer Data, we will notify you without undue
                      delay and in accordance with applicable law and the DPA.
                    </p>
                  </section>

                  <section id='ip'>
                    <h2 className='text-2xl font-semibold'>14. Intellectual Property</h2>
                    <p>
                      We own and retain all right, title, and interest in and to the Service,
                      including all software, models, algorithms, interfaces, Documentation, and all
                      improvements, modifications, and derivative works thereof, and all
                      intellectual property rights therein. Subject to this Agreement, we grant you
                      a limited, non-exclusive, non-transferable, non-sublicensable right during the
                      subscription term to access and use the Service for your internal business
                      purposes. No rights are granted except as expressly set forth in this
                      Agreement.
                    </p>
                    <p>
                      If you provide suggestions, ideas, or feedback about the Service ("
                      <strong>Feedback</strong>"), you grant us a perpetual, irrevocable, worldwide,
                      royalty-free license to use and incorporate the Feedback into the Service and
                      our products without any obligation to you.
                    </p>
                  </section>

                  <section id='confidentiality'>
                    <h2 className='text-2xl font-semibold'>15. Confidentiality</h2>
                    <p>
                      Each party will protect the other party's Confidential Information using at
                      least the same degree of care it uses to protect its own confidential
                      information of a similar nature (and in no event less than reasonable care),
                      and will not use or disclose Confidential Information except as necessary to
                      perform this Agreement. Confidential Information does not include information
                      that (a) is or becomes publicly known without breach of this Agreement, (b)
                      was known to the receiving party without obligation of confidence before
                      disclosure, (c) is independently developed without use of the disclosing
                      party's Confidential Information, or (d) is rightfully obtained from a third
                      party without restriction. A party may disclose Confidential Information to
                      the extent required by law, provided it gives reasonable prior notice (where
                      permitted) and cooperates with reasonable efforts to limit the disclosure.
                    </p>
                  </section>

                  <section id='warranties'>
                    <h2 className='text-2xl font-semibold'>16. Warranties & Disclaimer</h2>
                    <p>
                      Each party represents and warrants that it has the legal authority to enter
                      into this Agreement. We warrant that we will provide the Service in a manner
                      that materially conforms to the Documentation. Your exclusive remedy, and our
                      sole liability, for a breach of the foregoing warranty is, at our option, to
                      re-perform the deficient portion of the Service or, if we are unable to do so
                      within a reasonable period, to terminate the affected subscription and refund
                      any prepaid, unused fees for the affected portion.
                    </p>
                    <p>
                      <strong>
                        EXCEPT AS EXPRESSLY STATED IN THIS SECTION, THE SERVICE AND ALL AI OUTPUT
                        ARE PROVIDED "AS IS" AND "AS AVAILABLE," AND WE AND OUR LICENSORS DISCLAIM
                        ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING
                        ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE,
                        NON-INFRINGEMENT, ACCURACY, OR QUIET ENJOYMENT. WITHOUT LIMITING THE
                        FOREGOING, WE DO NOT WARRANT THAT THE SERVICE OR AI OUTPUT WILL BE
                        UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF HARMFUL COMPONENTS, OR THAT
                        ANY CONTENT WILL BE PRESERVED WITHOUT LOSS.
                      </strong>
                    </p>
                  </section>

                  <section id='indemnification'>
                    <h2 className='text-2xl font-semibold'>17. Indemnification</h2>
                    <p>
                      <strong>By Auxx.</strong> We will defend you against any third-party claim
                      alleging that the Service, as provided by us and used in accordance with this
                      Agreement, infringes a third party's U.S. patent, copyright, or registered
                      trademark, and we will pay any damages finally awarded by a court of competent
                      jurisdiction or agreed in settlement. The foregoing does not apply to claims
                      arising from (a) Customer Data or any combination of the Service with data,
                      software, or services not provided by us, (b) modifications to the Service not
                      made by us, (c) use of the Service other than as permitted under this
                      Agreement or the Documentation, or (d) continued use of an allegedly
                      infringing version after we have provided a non-infringing alternative. If the
                      Service is or, in our reasonable opinion, is likely to be enjoined, we may, at
                      our option, (i) procure the right for you to continue using the Service, (ii)
                      modify the Service to make it non-infringing, or (iii) terminate the affected
                      subscription and refund any prepaid, unused fees. This paragraph states our
                      sole liability and your exclusive remedy for third-party infringement claims.
                    </p>
                    <p>
                      <strong>By Customer.</strong> You will defend us, our affiliates, and our
                      respective officers, directors, employees, and agents against any third-party
                      claim arising from or related to (a) Customer Data, (b) your or your
                      Authorized Users' use of the Service in violation of this Agreement (including
                      the Acceptable Use Policy), (c) your sending of any message (including AI
                      Output you approved), (d) your violation of any applicable law or third-party
                      right, or (e) your breach of any agreement with a third party whose service
                      you connected as an Integration, and you will pay any damages finally awarded
                      or agreed in settlement.
                    </p>
                    <p>
                      <strong>Procedure.</strong> The indemnified party must (i) promptly notify the
                      indemnifying party of the claim, (ii) grant the indemnifying party sole
                      control of the defense and settlement (provided that no settlement imposes any
                      obligation or liability on the indemnified party without its prior written
                      consent, not unreasonably withheld), and (iii) reasonably cooperate, at the
                      indemnifying party's expense.
                    </p>
                  </section>

                  <section id='liability'>
                    <h2 className='text-2xl font-semibold'>18. Limitation of Liability</h2>
                    <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:</p>
                    <p>
                      <strong>(a) No Indirect Damages.</strong> NEITHER PARTY WILL BE LIABLE FOR ANY
                      INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
                      OR FOR ANY LOSS OF PROFITS, REVENUE, BUSINESS, GOODWILL, DATA, OR USE, ARISING
                      OUT OF OR RELATED TO THIS AGREEMENT, EVEN IF ADVISED OF THE POSSIBILITY OF
                      SUCH DAMAGES AND EVEN IF A LIMITED REMEDY FAILS OF ITS ESSENTIAL PURPOSE.
                    </p>
                    <p>
                      <strong>(b) Aggregate Cap.</strong> EACH PARTY'S TOTAL AGGREGATE LIABILITY
                      ARISING OUT OF OR RELATED TO THIS AGREEMENT WILL NOT EXCEED THE TOTAL FEES
                      PAID OR PAYABLE BY CUSTOMER TO AUXX IN THE TWELVE (12) MONTHS IMMEDIATELY
                      PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
                    </p>
                    <p>
                      <strong>(c) Carve-Outs.</strong> The limitations in this Section do not apply
                      to: (i) a party's indemnification obligations; (ii) breach of confidentiality
                      obligations; (iii) Customer's breach of the Acceptable Use Policy or payment
                      obligations; (iv) either party's gross negligence, willful misconduct, or
                      fraud; or (v) liability that cannot be limited under applicable law.
                    </p>
                    <p>
                      The parties agree that the limitations in this Section are a fundamental basis
                      of the bargain and that the fees reflect the allocation of risk they
                      establish.
                    </p>
                  </section>

                  <section id='term'>
                    <h2 className='text-2xl font-semibold'>19. Term & Termination</h2>
                    <p>
                      This Agreement begins on the date you first accept it and continues until all
                      subscriptions have expired or been terminated. Either party may terminate this
                      Agreement or an affected Order for material breach if the other party fails to
                      cure the breach within thirty (30) days after receiving written notice
                      describing the breach in reasonable detail. We may suspend or terminate the
                      Service or your account immediately and without prior notice if (a) you
                      violate the Acceptable Use Policy, (b) you fail to pay undisputed fees that
                      are more than fifteen (15) days overdue, (c) required by law or order of a
                      governmental authority, or (d) you become insolvent, make an assignment for
                      the benefit of creditors, or become the subject of bankruptcy proceedings.
                    </p>
                    <p>
                      On termination or expiration: (i) your right to access and use the Service
                      ends; (ii) for thirty (30) days after termination, you may request an export
                      of Customer Data in a commercially reasonable format, after which we may
                      delete Customer Data from our active systems (residual backups are deleted on
                      normal rotation); and (iii) any provision that by its nature should survive
                      termination will survive, including Sections 6, 8, 10, 14–18, 22, 24, and 26.
                    </p>
                  </section>

                  <section id='beta'>
                    <h2 className='text-2xl font-semibold'>20. Beta Features</h2>
                    <p>
                      We may make features available on an alpha, beta, preview, or early-access
                      basis ("<strong>Beta Features</strong>"). Beta Features are provided "as is"
                      for evaluation only, are not subject to any service-level commitment, may be
                      changed or discontinued at any time, and are not recommended for production
                      use. Our liability for Beta Features is excluded to the fullest extent
                      permitted by law.
                    </p>
                  </section>

                  <section id='modifications'>
                    <h2 className='text-2xl font-semibold'>21. Service Modifications</h2>
                    <p>
                      We continuously improve the Service and may add, modify, or remove features at
                      any time. We will not make a change that, taken as a whole, materially reduces
                      the core functionality of the Service during your paid subscription term
                      without giving you notice and a reasonable opportunity to terminate for
                      convenience and receive a pro rata refund of prepaid, unused fees. We may
                      modify these Terms from time to time; if a revision is material, we will
                      provide at least thirty (30) days' advance notice by email or in-product
                      notice before the new Terms take effect. Your continued use of the Service
                      after the effective date constitutes acceptance.
                    </p>
                  </section>

                  <section id='notices'>
                    <h2 className='text-2xl font-semibold'>22. Notices</h2>
                    <p>
                      Notices to you may be given by email to the address associated with your
                      account, by in-product notice, or by posting to our website, and will be
                      deemed given on sending. Notices to us must be sent to {config.emails.support}{' '}
                      and by mail to Auxx AI, LLC, {config.address}. You consent to receive
                      communications from us electronically, and you agree that electronic
                      communications satisfy any legal requirement that a communication be in
                      writing.
                    </p>
                  </section>

                  <section id='dmca'>
                    <h2 className='text-2xl font-semibold'>23. DMCA & Copyright</h2>
                    <p>
                      We respect intellectual property rights and expect our users to do the same.
                      If you believe that material accessible through the Service infringes your
                      copyright, you may submit a notice of claimed infringement to our designated
                      agent under the Digital Millennium Copyright Act at {config.emails.support}.
                      Your notice must include the information required by 17 U.S.C. § 512(c)(3). We
                      may remove or disable access to allegedly infringing material and terminate
                      the accounts of repeat infringers in appropriate circumstances.
                    </p>
                  </section>

                  <section id='governing-law'>
                    <h2 className='text-2xl font-semibold'>
                      24. Governing Law & Dispute Resolution
                    </h2>
                    <p>
                      This Agreement is governed by the laws of the State of California, without
                      regard to its conflict-of-laws principles. The United Nations Convention on
                      Contracts for the International Sale of Goods does not apply.
                    </p>
                    <p>
                      <strong>Informal Resolution.</strong> Before initiating any formal proceeding,
                      the parties will attempt to resolve the dispute through good- faith
                      negotiations for at least thirty (30) days after written notice of the
                      dispute.
                    </p>
                    <p>
                      <strong>Binding Arbitration.</strong> If the parties do not resolve the
                      dispute, it will be finally settled by binding arbitration administered by
                      JAMS under its Streamlined Arbitration Rules and Procedures, before a single
                      arbitrator. The seat of arbitration will be Los Angeles, California, and the
                      language of the arbitration will be English. Judgment on the award may be
                      entered in any court of competent jurisdiction.
                    </p>
                    <p>
                      <strong>Class Action Waiver.</strong> EACH PARTY AGREES THAT ANY DISPUTE WILL
                      BE RESOLVED ON AN INDIVIDUAL BASIS, AND THAT NEITHER PARTY MAY BRING OR
                      PARTICIPATE IN A CLASS, COLLECTIVE, OR REPRESENTATIVE ACTION AGAINST THE
                      OTHER. The arbitrator may not consolidate claims of more than one person or
                      preside over any form of class or representative proceeding.
                    </p>
                    <p>
                      <strong>Carve-Out.</strong> Either party may seek injunctive or other
                      equitable relief in a court of competent jurisdiction located in Ventura
                      County, California for actual or threatened infringement, misappropriation, or
                      violation of its intellectual property or Confidential Information. The
                      parties consent to the exclusive jurisdiction and venue of those courts for
                      such actions.
                    </p>
                  </section>

                  <section id='export'>
                    <h2 className='text-2xl font-semibold'>25. Export Controls & Sanctions</h2>
                    <p>
                      The Service is subject to U.S. export control and sanctions laws. You
                      represent and warrant that (a) you are not located in, and will not use or
                      export the Service to, any country or region subject to U.S. embargoes or
                      comprehensive sanctions, and (b) you are not listed on any U.S. government
                      list of prohibited or restricted parties, including the OFAC Specially
                      Designated Nationals list. You will comply with all applicable export and
                      sanctions laws in your use of the Service.
                    </p>
                  </section>

                  <section id='misc'>
                    <h2 className='text-2xl font-semibold'>26. Miscellaneous</h2>
                    <p>
                      <strong>Entire Agreement.</strong> This Agreement (including the Privacy
                      Policy, any applicable DPA, and any Order Form) is the entire agreement
                      between the parties regarding the Service and supersedes all prior or
                      contemporaneous agreements on the same subject. If there is a conflict, the
                      order of precedence is: (1) the Order Form, (2) these Terms, (3) the Privacy
                      Policy, (4) the Documentation.
                    </p>
                    <p>
                      <strong>Severability; No Waiver.</strong> If any provision is held
                      unenforceable, it will be modified to the minimum extent necessary to make it
                      enforceable, and the remaining provisions will remain in full force. No waiver
                      will be effective unless in writing.
                    </p>
                    <p>
                      <strong>Assignment.</strong> You may not assign this Agreement, by operation
                      of law or otherwise, without our prior written consent. We may assign this
                      Agreement in connection with a merger, acquisition, reorganization, or sale of
                      all or substantially all of our assets. Any attempted assignment in violation
                      of this Section is void.
                    </p>
                    <p>
                      <strong>Force Majeure.</strong> Neither party will be liable for any delay or
                      failure to perform (other than payment obligations) caused by events beyond
                      its reasonable control, including acts of God, war, terrorism, civil unrest,
                      labor disputes, internet or telecommunications failures, denial-of-service
                      attacks, or failures of third-party providers.
                    </p>
                    <p>
                      <strong>Independent Contractors.</strong> The parties are independent
                      contractors. This Agreement does not create any partnership, joint venture,
                      agency, or employment relationship.
                    </p>
                    <p>
                      <strong>No Third-Party Beneficiaries.</strong> This Agreement is for the
                      benefit of the parties only and creates no rights in any third party,
                      including any end customer of Customer.
                    </p>
                    <p>
                      <strong>Government End Users.</strong> The Service is "commercial computer
                      software" and "commercial computer software documentation" as those terms are
                      used in 48 C.F.R. § 12.212 and 48 C.F.R. § 227.7202. Government end users
                      acquire the Service with only those rights set forth in this Agreement.
                    </p>
                    <p>
                      <strong>Electronic Signatures.</strong> The parties agree that this Agreement
                      and any Order may be executed electronically and that electronic signatures
                      have the same force and effect as handwritten signatures.
                    </p>
                  </section>

                  <section id='contact'>
                    <h2 className='text-2xl font-semibold'>27. Contact Us</h2>
                    <p>If you have questions about these Terms, please contact us at:</p>
                    <p className='mt-2'>
                      <strong>Auxx AI, LLC</strong>
                      <br />
                      <strong>Email:</strong> {config.emails.support}
                      <br />
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

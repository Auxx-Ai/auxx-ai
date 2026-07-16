// import { FB_LOGO_URL, IMPRINT_ADDRESS, IMPRINT_URL, PRIVACY_URL } from '@/lib/constants'
import { constants, WEBAPP_URL } from '@auxx/config/server'
import {
  Body,
  Container,
  Html,
  Img,
  Link,
  pixelBasedPreset,
  Section,
  Tailwind,
  Text,
} from '@react-email/components'
import React from 'react'

import { Logo } from './email-logo'

void React

const fbLogoUrl =
  'https://s3.eu-central-1.amazonaws.com/listmonk-formbricks/Formbricks-Light-transparent.png' //FB_LOGO_URL
const logoLink = `${WEBAPP_URL}?utm_source=email_header&utm_medium=email`

/** White-label footer identity — when provided, replaces the Auxx header logo + footer entirely. */
export interface EmailBusinessIdentity {
  name: string
  addressLines?: string[]
  phone?: string
  website?: string
}

interface EmailTemplateProps {
  readonly children: React.ReactNode
  readonly logoUrl?: string
  /**
   * White-label mode (plans/dispatch/money/15) — when set, the email drops all Auxx chrome (logo
   * fallback + "sent via Auxx.ai" footer) and renders the business's own header + footer instead.
   * A `logoUrl` still wins for the header image; without one, the business name is shown as text.
   */
  readonly business?: EmailBusinessIdentity
}

export async function EmailTemplate({
  children,
  logoUrl,
  business,
}: EmailTemplateProps): Promise<React.JSX.Element> {
  const isDefaultLogo = !logoUrl || logoUrl === fbLogoUrl

  if (business) {
    return (
      <Html>
        <Tailwind config={{ presets: [pixelBasedPreset] }}>
          <Body
            className='m-0 h-full w-full justify-center bg-slate-50 py-6 text-center text-base font-medium text-slate-800'
            style={{
              fontFamily: "'Jost', 'Helvetica Neue', 'Segoe UI', 'Helvetica', 'sans-serif'",
            }}>
            <Section>
              {logoUrl && !isDefaultLogo ? (
                <Img
                  data-testid='logo-image'
                  alt={business.name}
                  className='mx-auto max-h-[100px] w-80 object-contain'
                  src={logoUrl}
                />
              ) : (
                <Text className='m-0 text-xl font-bold text-slate-800'>{business.name}</Text>
              )}
            </Section>
            <Container className='mx-auto my-8 max-w-xl rounded-md bg-white p-4 text-left'>
              {children}
            </Container>
            <Section className='mt-4 text-center text-sm'>
              <Text className='m-0 font-normal text-slate-500'>{business.name}</Text>
              {business.addressLines?.map((line) => (
                <Text key={line} className='m-0 font-normal text-slate-500 opacity-60'>
                  {line}
                </Text>
              ))}
              {(business.phone || business.website) && (
                <Text className='m-0 font-normal text-slate-500 opacity-60'>
                  {business.phone}
                  {business.phone && business.website && ' • '}
                  {business.website && (
                    <Link
                      href={business.website}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-slate-500'>
                      {business.website}
                    </Link>
                  )}
                </Text>
              )}
            </Section>
          </Body>
        </Tailwind>
      </Html>
    )
  }

  return (
    <Html>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
        }}>
        <Body
          className='m-0 h-full w-full justify-center bg-slate-50 py-6 text-center text-base font-medium text-slate-800'
          style={{
            fontFamily: "'Jost', 'Helvetica Neue', 'Segoe UI', 'Helvetica', 'sans-serif'",
          }}>
          <Section>
            {isDefaultLogo ? (
              <Link href={logoLink} target='_blank'>
                <Logo className='mx-auto w-60' />
              </Link>
            ) : (
              <Img
                data-testid='logo-image'
                alt='Logo'
                className='mx-auto max-h-[100px] w-80 object-contain'
                src={logoUrl}
              />
            )}
          </Section>
          <Container className='mx-auto my-8 max-w-xl rounded-md bg-white p-4 text-left'>
            {children}
          </Container>

          <Section className='mt-4 text-center text-sm'>
            <Link
              className='m-0 font-normal text-slate-500'
              href={`${WEBAPP_URL}?utm_source=email_footer&utm_medium=email`}
              target='_blank'
              rel='noopener noreferrer'>
              This email was sent via Auxx.ai.
            </Link>
            {constants.IMPRINT_ADDRESS && (
              <Text className='m-0 font-normal text-slate-500 opacity-50'>
                {constants.IMPRINT_ADDRESS}
              </Text>
            )}
            <Text className='m-0 font-normal text-slate-500 opacity-50'>
              {constants.IMPRINT_URL && (
                <Link
                  href={constants.IMPRINT_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-slate-500'>
                  Imprint
                </Link>
              )}
              {constants.IMPRINT_URL && constants.PRIVACY_URL && ' • '}
              {constants.PRIVACY_URL && (
                <Link
                  href={constants.PRIVACY_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-slate-500'>
                  Privacy Policy
                </Link>
              )}
            </Text>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  )
}

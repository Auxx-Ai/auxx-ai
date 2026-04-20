// apps/homepage/src/app/layout.tsx
import { configService } from '@auxx/credentials/config'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import '@auxx/ui/styles/random-gradient.css'
import { config } from '~/lib/config'
import { ConfigProvider } from '~/lib/config-context'
import { ThemeProvider, ThemeScript } from '~/lib/theme'
import { PostHogProvider } from '~/providers/posthog-provider'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(config.urls.homepage),
  title: {
    default: config.name,
    template: `%s | ${config.name}`,
  },
  description: config.description,
  keywords: [
    'AI customer support',
    'Shopify support',
    'email automation',
    'customer service AI',
    'e-commerce support',
    'automated ticketing',
    'Gmail integration',
    'Outlook integration',
  ],
  authors: [{ name: config.name }],
  creator: config.name,
  publisher: config.name,
  category: 'technology',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: config.urls.homepage,
    title: config.name,
    description: config.description,
    siteName: config.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: config.name,
    description: config.description,
    site: config.links.twitter,
    creator: '@auxxlift',
  },
  manifest: '/site.webmanifest',
  alternates: {
    canonical: config.urls.homepage,
  },
}

function OrganizationJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Auxx AI',
    url: config.urls.homepage,
    logo: `${config.urls.homepage}/logo.png`,
    description: 'Open-source AI-powered CRM and customer support platform for Shopify businesses',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '5160 Gabbert Rd',
      addressLocality: 'Moorpark',
      addressRegion: 'CA',
      postalCode: '93021',
      addressCountry: 'US',
    },
    contactPoint: [
      { '@type': 'ContactPoint', email: 'support@auxx.ai', contactType: 'customer support' },
      { '@type': 'ContactPoint', email: 'sales@auxx.ai', contactType: 'sales' },
    ],
    sameAs: [config.links.twitter, config.links.linkedin, config.links.github],
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

function WebSiteJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Auxx.ai',
    url: config.urls.homepage,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${config.urls.docs}?search={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const posthogKey = configService.get<string>('POSTHOG_KEY') || ''
  const posthogHost = configService.get<string>('POSTHOG_HOST') || 'https://us.i.posthog.com'

  return (
    <html lang='en' data-theme='dark' suppressHydrationWarning>
      <head>
        <ThemeScript />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <ConfigProvider config={config}>
            <PostHogProvider posthogKey={posthogKey} posthogHost={posthogHost}>
              {children}
            </PostHogProvider>
          </ConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

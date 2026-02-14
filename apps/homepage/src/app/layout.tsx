import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { config } from '~/lib/config'

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='en'>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        data-theme='quartz'>
        {children}
      </body>
    </html>
  )
}

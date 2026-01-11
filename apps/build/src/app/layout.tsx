import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import '@auxx/ui/global.css'
import { IS_MAC_SCRIPT } from '@auxx/utils'

import { ClientProviders } from './client-providers'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://build.auxx.ai'),
  title: {
    default: 'Auxx Developer Portal',
    template: '%s | Auxx Developer Portal',
  },
  description: 'Build and manage apps for the Auxx.ai marketplace',
  keywords: [
    'Auxx developer portal',
    'app marketplace',
    'API integration',
    'Auxx apps',
    'build apps',
    'app development',
    'Shopify app integration',
    'developer tools',
    'app publishing',
    'marketplace apps',
  ],
  authors: [{ name: 'Auxx.ai' }],
  creator: 'Auxx.ai',
  publisher: 'Auxx.ai',
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
    url: 'https://build.auxx.ai',
    title: 'Auxx Developer Portal',
    description: 'Build and manage apps for the Auxx.ai marketplace',
    siteName: 'Auxx Developer Portal',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auxx Developer Portal',
    description: 'Build and manage apps for the Auxx.ai marketplace',
    creator: '@auxxlift',
  },
  alternates: {
    canonical: 'https://build.auxx.ai',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: IS_MAC_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-hidden`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}

// apps/docs/src/app/layout.tsx
import './global.css'
import { IS_MAC_SCRIPT } from '@auxx/utils'
import { RootProvider } from 'fumadocs-ui/provider'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.auxx.ai'),
  title: {
    default: 'Auxx Documentation',
    template: '%s | Auxx Documentation',
  },
  description:
    'Documentation, guides, and API reference for Auxx.ai — AI-powered email support for Shopify businesses',
  keywords: [
    'Auxx documentation',
    'Auxx.ai docs',
    'AI email support',
    'Shopify support automation',
    'API reference',
    'developer guides',
    'customer support AI',
    'help desk automation',
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
    url: 'https://docs.auxx.ai',
    title: 'Auxx Documentation',
    description:
      'Documentation, guides, and API reference for Auxx.ai — AI-powered email support for Shopify businesses',
    siteName: 'Auxx Documentation',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auxx Documentation',
    description:
      'Documentation, guides, and API reference for Auxx.ai — AI-powered email support for Shopify businesses',
    creator: '@auxxlift',
  },
  alternates: {
    canonical: 'https://docs.auxx.ai',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' className={inter.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: IS_MAC_SCRIPT }} />
      </head>
      <body className='flex flex-col min-h-screen'>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}

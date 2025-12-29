// apps/web/src/app/layout.tsx
// import '@auxx/ui/globals.css'

// import '~/styles/globals.css'
import '@auxx/ui/global.css'
import '~/styles/react-flow.css'
import '~/lib/immer-config' // Enable Immer MapSet plugin

import { type Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '700'] })

import { ClientProviders } from './client-providers'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://app.auxx.ai'),
  title: {
    default: 'Auxx.ai - AI Customer Support',
    template: '%s | Auxx.ai',
  },
  description: 'AI-powered email support ticket automation for Shopify businesses',
  keywords: [
    'AI customer support',
    'Shopify support',
    'email automation',
    'customer service AI',
    'e-commerce support',
    'automated ticketing',
    'Gmail integration',
    'Outlook integration',
    'support automation',
    'helpdesk software',
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
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://app.auxx.ai',
    title: 'Auxx.ai - AI Customer Support',
    description: 'AI-powered email support ticket automation for Shopify businesses',
    siteName: 'Auxx.ai',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auxx.ai - AI Customer Support',
    description: 'AI-powered email support ticket automation for Shopify businesses',
    creator: '@auxxlift',
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL || 'https://app.auxx.ai',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.className}`} suppressHydrationWarning>
      <body className="bg-primary-100">
        {/* <div className="h-50 bg-red-500 shrink-0">HELLLO</div> */}

        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}

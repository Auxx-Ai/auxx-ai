// apps/docs/src/app/layout.tsx
import './global.css'
import { RootProvider } from 'fumadocs-ui/provider'
import { Inter } from 'next/font/google'
import { IS_MAC_SCRIPT } from '@auxx/utils'

const inter = Inter({
  subsets: ['latin'],
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: IS_MAC_SCRIPT }} />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}

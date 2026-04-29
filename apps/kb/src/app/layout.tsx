// apps/kb/src/app/layout.tsx

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Knowledge Base',
  description: 'Knowledge Base',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}

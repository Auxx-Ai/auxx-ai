import type { Metadata } from 'next'
// import "~/styles/globals.css";

export const metadata: Metadata = {
  title: 'Auxx.ai Knowledge Base',
  description: 'Knowledge Base for Auxx.ai',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  )
}
